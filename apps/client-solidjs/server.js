/** The server, as this client sees it: what it says, kept live over /ws */
import { createProjection, createRoot, createSignal, refresh } from 'solid-js'

const params = new URLSearchParams(location.search)
/** The server that served this page, or another with ?server= */
export const url = params.get('server') || location.origin
export const me = params.get('user') || 'you'

export const api = (path, body) =>
	fetch(
		url + path,
		body === undefined
			? {}
			: {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'x-user': me },
					body: JSON.stringify(body),
				},
	).then(async (r) => {
		const json = await r.json()
		if (!r.ok) throw new Error(json.error)
		return json
	})

/** Lives as long as the page; every component reads the same server */
export const { connected, threads } = createRoot(() => {
	const [connected, setConnected] = createSignal(false, { name: 'connected' })
	/** Every thread, kept by id: a new one adds a row, the rest stay put */
	const threads = createProjection(() => api('/api/threads'), [], { key: 'id', name: 'threads' })

	/** The socket only says that something changed; the threads are asked again */
	const watch = () => {
		const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
		socket.onopen = () => {
			setConnected(true)
			refresh(threads)
		}
		socket.onmessage = () => refresh(threads)
		socket.onclose = () => {
			setConnected(false)
			setTimeout(watch, 1000)
		}
	}
	watch()
	return { connected, threads }
})
