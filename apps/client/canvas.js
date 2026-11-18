/**
 * A thread's canvas, a page of the side column: tldraw, synced with the thread's room on the server, where agents draw
 * too. tldraw is React, so it's an island here, loaded from esm.sh when a canvas first opens (React ships no modules a
 * browser can import, and tldraw is some 150 packages), at the version the server's room speaks.
 *
 * A tab with the canvas open is its editor host: the server hands it agents' looks and actions (./canvas/host.js) and
 * it answers what they found or did, against the real editor. The tab someone touched last is the one asked.
 */
import html from '@solidjs/html'
import { createSignal, onSettled, Show, untrack } from 'solid-js'
import { Icon } from './icons.js'
import { PageTabs, toggleOverview } from './overview.js'
import { api, me, url } from './server.js'

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

/** How often a tab says it's being used, at most */
const ACTIVE = 2000

/** The editor, synced with the thread's room, and this tab as its host */
function board({ react, dom, tldraw, sync, host }, element, id) {
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
		active()
	}
	const Board = () => {
		const store = sync.useSync(options)
		return react.createElement(tldraw.Tldraw, { store, inferDarkMode: true, onMount })
	}
	for (const kind of ['pointerdown', 'keydown', 'focusin', 'wheel'])
		element.addEventListener(kind, active, { passive: true })
	const root = dom.createRoot(element)
	root.render(react.createElement(Board))
	return () => {
		editor = undefined
		root.unmount()
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
		<aside class="overview canvas" aria-label="Canvas">
			<header class="page-head">
				<${PageTabs} id=${id} />
				<button
					type="button"
					class="ghost small close"
					aria-label="Close the canvas"
					onClick=${(_event) => toggleOverview(id)}
				>
					<${Icon} name="close" />
				</button>
			</header>
			<${Show} when=${() => !ready()}>
				<p class="mute">${() => failed() || 'Loading the canvas…'}</p>
			<//>
			<div class="board" ref=${(el) => (element = el)}></div>
		</aside>
	`
}
