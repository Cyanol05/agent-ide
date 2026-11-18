/**
 * A thread's canvas, a page of the side column: tldraw, synced with the thread's room on the server, where agents draw
 * too. tldraw is React, so it's an island here, loaded from esm.sh when a canvas first opens (React ships no modules a
 * browser can import, and tldraw is some 150 packages), at the version the server's room speaks.
 */
import html from '@solidjs/html'
import { createSignal, onSettled, Show, untrack } from 'solid-js'
import { Icon } from './icons.js'
import { PageTabs, toggleOverview } from './overview.js'
import { api, me, url } from './server.js'

const REACT = '19.3.0'
const deps = `deps=react@${REACT},react-dom@${REACT}`

/** React, react-dom and tldraw as one set of modules, fetched once a page */
let loading
const load = (version) =>
	(loading ??= (async () => {
		const css = document.createElement('link')
		css.rel = 'stylesheet'
		css.href = `https://esm.sh/tldraw@${version}/tldraw.css`
		document.head.append(css)
		const [react, dom, tldraw, sync] = await Promise.all([
			import(`https://esm.sh/react@${REACT}`),
			import(`https://esm.sh/react-dom@${REACT}/client?deps=react@${REACT}`),
			import(`https://esm.sh/tldraw@${version}?${deps}`),
			import(`https://esm.sh/@tldraw/sync@${version}?${deps}`),
		])
		return { react, dom, tldraw, sync }
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

/** The editor, synced with the thread's room */
function board({ react, dom, tldraw, sync }, host, id) {
	// The same options every render, or useSync starts over each time
	const options = {
		uri: `${url.replace(/^http/, 'ws')}/api/threads/${id}/canvas`,
		assets,
		userInfo: { id: me, name: me },
	}
	const Board = () => {
		const store = sync.useSync(options)
		return react.createElement(tldraw.Tldraw, { store, inferDarkMode: true })
	}
	const root = dom.createRoot(host)
	root.render(react.createElement(Board))
	return () => root.unmount()
}

export function Canvas(props) {
	// One thread for this page's whole life
	const id = untrack(() => props.id)
	const [failed, setFailed] = createSignal('')
	const [ready, setReady] = createSignal(false)
	let host
	onSettled(() => {
		let gone = false,
			unmount
		api(`/api/threads/${id}/canvas`)
			.then(async ({ tldraw }) => {
				const modules = await load(tldraw)
				if (gone) return
				unmount = board(modules, host, id)
				setReady(true)
			})
			.catch((error) =>
				setFailed(
					error.message === "Can't reach the server"
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
			<div class="board" ref=${(el) => (host = el)}></div>
		</aside>
	`
}
