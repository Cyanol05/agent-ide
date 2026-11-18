/**
 * A thread's canvas, a page of the side column: tldraw, synced with the thread's room on the server, where agents draw
 * too. tldraw is React, so it's an island here, loaded from esm.sh when a canvas first opens (React ships no modules a
 * browser can import, and tldraw is some 150 packages), at the version the server's room speaks.
 *
 * A tab with the canvas open is its editor host: the server hands it agents' looks and actions (./canvas/host.js) and
 * it answers what they found or did, against the real editor. The tab someone touched last is the one asked. When no
 * tab shows that canvas, the ade page someone used last brings up an editor for it out of sight (offerToHost), keeps
 * it a minute after its last call, then lets it go; one at a time.
 */
import html from '@solidjs/html'
import { createSignal, onSettled, Show, untrack } from 'solid-js'
import { shortLabel } from './agent.js'
import { Panes } from './panes.js'
import { openSide, PageTabs } from './side.js'
import { api, colorOf, me, url } from './server.js'

/** The versions canvas/tldraw.js loads; the server's @tldraw/sync-core must be the same */
const TLDRAW = '5.6.1'
const REACT = '19.3.0'
const deps = `deps=react@${REACT},react-dom@${REACT}`

/** React, react-dom, tldraw and the host as one set of modules, fetched once a page */
let loading
const load = () =>
	(loading ??= (async () => {
		const css = document.createElement('link')
		css.rel = 'stylesheet'
		css.href = `https://esm.sh/tldraw@${TLDRAW}/tldraw.css`
		document.head.append(css)
		const [react, dom, tldraw, sync, host] = await Promise.all([
			import(`https://esm.sh/react@${REACT}`),
			import(`https://esm.sh/react-dom@${REACT}/client?deps=react@${REACT}`),
			import('./canvas/tldraw.js'),
			import(`https://esm.sh/@tldraw/sync@${TLDRAW}?${deps}`),
			import('./canvas/host.js'),
		])
		return { react, dom, tldraw, sync, host }
	})().catch((error) => {
		loading = undefined
		throw error
	}))

/** Pasted images live in the canvas itself, as data URLs */
const assets = {
	upload: (_asset, file) =>
		new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve({ src: reader.result })
			reader.onerror = () => reject(reader.error)
			reader.readAsDataURL(file)
		}),
	resolve: (asset) => asset.props.src,
}

/** Each thread's editor while its canvas is open here, and the area to show once it opens */
const editors = new Map()
const waiting = new Map()

/** Opens a thread's canvas on an area of it, or just opens it */
export function showOnCanvas(id, box) {
	openSide(id, 'canvas')
	if (!box) return
	const editor = editors.get(id)
	if (editor) frame(editor, box)
	else waiting.set(id, box)
}
const frame = (editor, box) =>
	editor.zoomToBounds(box, { inset: 48, targetZoom: 1, animation: { duration: 300 } })

/** How often a tab says it's being used, at most */
const ACTIVE = 2000

/** The editor, synced with the thread's room, and this tab as its host; a hidden one only answers calls (`called`) */
function board({ react, dom, tldraw, sync, host }, element, id, { hidden = false, called } = {}) {
	const tab = crypto.randomUUID()
	const path = `/api/threads/${id}/canvas`
	let editor,
		said = 0
	const active = () => {
		if (!editor || Date.now() - said < ACTIVE) return
		said = Date.now()
		api(path, { active: tab }).catch(() => {})
	}
	// What the server hands this tab: a look or a batch of actions, answered as found or done, or as the error it hit
	const handle = async ({ call, look, act }) => {
		if (!call) return
		called?.()
		let answer
		try {
			if (!editor) throw new Error('the canvas is still loading')
			answer = { call, result: look ? await host.look(editor, look) : host.act(editor, act) }
		} catch (error) {
			answer = { call, error: error.message }
		}
		await api(path, { answer }).catch(() => {})
	}
	// The same options every render, or useSync starts over each time
	const options = {
		uri: `${url.replace(/^http/, 'ws')}${path}?user=${encodeURIComponent(me)}&tab=${tab}`,
		assets,
		userInfo: { id: me, name: me },
		onCustomMessageReceived: handle,
	}
	const onMount = (mounted) => {
		editor = mounted
		if (!hidden) {
			editors.set(id, mounted)
			if (waiting.has(id)) frame(mounted, waiting.get(id))
			waiting.delete(id)
		}
		active()
	}
	const Board = () => {
		const store = sync.useSync(options)
		return react.createElement(tldraw.Tldraw, { store, inferDarkMode: true, onMount })
	}
	if (!hidden)
		for (const kind of ['pointerdown', 'keydown', 'focusin', 'wheel'])
			element.addEventListener(kind, active, { passive: true })
	const root = dom.createRoot(element)
	root.render(react.createElement(Board))
	return () => {
		if (editors.get(id) === editor) editors.delete(id)
		editor = undefined
		root.unmount()
	}
}

/** How long an editor brought up out of sight stays after its last call, for the calls that follow */
const KEEP = 60000
/** The one editor this page keeps out of sight: its thread, and how to let it go */
let unseen

/** Brings up an editor for a thread's canvas out of sight, to answer an agent; a tab showing it already answers */
async function bringUp(id) {
	if (editors.has(id)) return
	if (unseen?.id === id) return unseen.keep()
	unseen?.close()
	const modules = await load()
	const element = document.createElement('div')
	element.className = 'unseen-canvas'
	element.setAttribute('aria-hidden', 'true')
	document.body.append(element)
	let timer
	const mine = {
		id,
		keep: () => {
			clearTimeout(timer)
			timer = setTimeout(() => mine.close(), KEEP)
		},
		close: () => {
			clearTimeout(timer)
			unmount()
			element.remove()
			if (unseen === mine) unseen = undefined
		},
	}
	unseen = mine
	const unmount = board(modules, element, id, { hidden: true, called: () => mine.keep() })
	mine.keep()
}

/** How often a page says it's being used, at most */
const USED = 2000

/**
 * This page offers to host canvases it isn't showing: a socket the server asks over, and word when someone uses the
 * page, so the server asks the one used last. Answers how to stop.
 */
export function offerToHost() {
	let socket,
		retry,
		said = 0,
		stopped = false
	const connect = () => {
		socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/canvas`)
		socket.onmessage = (event) => {
			const { host } = JSON.parse(event.data)
			if (host) bringUp(host).catch((error) => console.error(`canvas ${host}: ${error.message}`))
		}
		socket.onclose = () => {
			if (!stopped) retry = setTimeout(connect, 1000)
		}
	}
	const used = () => {
		if (Date.now() - said < USED || socket?.readyState !== WebSocket.OPEN) return
		said = Date.now()
		socket.send(JSON.stringify({ active: true }))
	}
	connect()
	const kinds = ['pointerdown', 'keydown', 'focusin']
	for (const kind of kinds) document.addEventListener(kind, used, { passive: true })
	return () => {
		stopped = true
		clearTimeout(retry)
		socket.close()
		for (const kind of kinds) document.removeEventListener(kind, used)
		unseen?.close()
	}
}

export function Canvas(props) {
	// One thread for this page's whole life
	const id = untrack(() => props.id)
	const [failed, setFailed] = createSignal('')
	const [ready, setReady] = createSignal(false)
	let element
	onSettled(() => {
		let gone = false,
			unmount
		api(`/api/threads/${id}/canvas`)
			.then(async ({ tldraw }) => {
				if (tldraw !== TLDRAW)
					throw new Error(`The server runs tldraw ${tldraw}, this page ${TLDRAW}; they must match`)
				const modules = await load()
				if (gone) return
				unmount = board(modules, element, id)
				setReady(true)
			})
			.catch((error) =>
				setFailed(
					error.message === "Can't reach the server"
						? error.message
						: error.message.startsWith('The server runs')
							? error.message
							: `Couldn't load tldraw from esm.sh: ${error.message}`,
				),
			)
		return () => {
			gone = true
			unmount?.()
		}
	})
	return html`
		<aside class="side canvas" aria-label="Canvas">
			<${Panes}
				title="Canvas"
				head=${html`<${PageTabs} id=${id} />`}
				onClose=${(_event) => openSide(id, null)}
			>
				<${Show} when=${() => !ready()}>
					<p class="mute">${() => failed() || 'Loading the canvas…'}</p>
				<//>
				<div class="board" ref=${(el) => (element = el)}></div>
			<//>
		</aside>
	`
}

/** A canvas_act call's answer: its first line says what it did, the rest is what it touched */
function answerOf(step) {
	const [line, ...rest] = (step.result?.text ?? '').split('\n')
	try {
		return { line, ...JSON.parse(rest.join('\n')) }
	} catch {
		return { line, applied: [], shapes: [] }
	}
}

/** The area the shapes a batch touched cover, as they landed */
function areaOf(shapes = []) {
	const boxes = shapes.map((shape) => shape.bounds ?? shape).filter((box) => box.w !== undefined)
	if (!boxes.length) return undefined
	const x = Math.min(...boxes.map((box) => box.x)),
		y = Math.min(...boxes.map((box) => box.y))
	return {
		x,
		y,
		w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
		h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
	}
}

/**
 * An agent's batch of canvas actions, on its own row in the chat: ✎, its name, what it did ("moved 3, deleted 1").
 * Clicked, the canvas opens on what changed; opened, each action and its intent, and why any was skipped.
 */
export function CanvasRow(props) {
	const answer = () => answerOf(props.step)
	const actions = () =>
		(props.step.args.actions ?? []).map((action, at) => ({
			action,
			done: answer().applied?.[at],
		}))
	return html`
		<li class="elsewhere">
			<ol class="steps">
				<li class="call changed">
					<details>
						<summary
							title="Show it on the canvas"
							onClick=${() => showOnCanvas(props.thread, areaOf(answer().shapes))}
						>
							<span class="tool" style=${() => colorOf(props.agent.name)}
								>${() => shortLabel(props.agent.name)}</span
							>
							<span class="in">${() => `${answer().line} on the canvas`}</span>
						</summary>
						<div class="whole">
							<pre>
${() =>
									actions()
										.map(
											({ action, done }) =>
												`${action._type}${action.intent ? `: ${action.intent}` : ''}${done?.skipped ? ` (skipped: ${done.skipped})` : ''}`,
										)
										.join('\n')}</pre>
						</div>
					</details>
				</li>
			</ol>
		</li>
	`
}
