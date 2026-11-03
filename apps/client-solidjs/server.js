/** The server, as this client sees it: lists over HTTP, changes over /ws */
import {
	createMemo,
	createProjection,
	createRoot,
	createSignal,
	onSettled,
	refresh,
} from 'solid-js'

export const params = new URLSearchParams(location.search)
export const url = params.get('server') || location.origin
export const me = params.get('user') || 'you'
export const api = (path, body) =>
	fetch(url + path, {
		headers: { 'Content-Type': 'application/json', 'x-user': me },
		...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
	}).then(async (r) => {
		const json = await r.json()
		if (!r.ok) throw new Error(json.error)
		return json
	})

/** A socket belongs to its caller; disposing it also cancels a pending reconnect. */
export function watch(receive, opened = () => {}, closed = () => {}) {
	let socket, timer
	const connect = () => {
		socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
		socket.onopen = () => opened(socket)
		socket.onmessage = (m) => receive(JSON.parse(m.data))
		socket.onclose = () => {
			closed()
			timer = setTimeout(connect, 1000)
		}
	}
	connect()
	return () => {
		clearTimeout(timer)
		socket.onclose = socket.onmessage = socket.onopen = null
		socket.close()
	}
}

/** Page lifetime; components own the messages of just the threads on screen. */
export const { connected, threads, runners, current, openThread, family } = createRoot(() => {
	const [connected, setConnected] = createSignal(false)
	const [current, setCurrent] = createSignal(Number(params.get('thread')) || null)
	const threads = createProjection(() => api('/api/threads'), [], { key: 'id' })
	const runners = createProjection(() => api('/api/runners'), [], { key: 'name' })
	const reload = () => {
		refresh(threads)
		refresh(runners)
	}
	onSettled(() =>
		watch(
			reload,
			() => {
				setConnected(true)
				reload()
			},
			() => setConnected(false),
		),
	)
	const openThread = (id) => {
		setCurrent(id)
		document.body.classList.remove('list')
		const next = new URL(location.href)
		if (id) next.searchParams.set('thread', id)
		else next.searchParams.delete('thread')
		history.replaceState(null, '', next)
	}
	const family = createMemo(() => {
		if (!current()) return [null]
		const byId = new Map(threads.map((t) => [t.id, t]))
		const parent = (id) => byId.get(id)?.parent ?? forkedFrom(byId.get(id))
		let root = current()
		for (let n = 0; parent(root) && byId.has(parent(root)) && n < 20; n++) root = parent(root)
		const ids = [root]
		for (let i = 0; i < ids.length; i++)
			for (const t of threads)
				if (parent(t.id) === ids[i] && !ids.includes(t.id) && !t.hidden) ids.push(t.id)
		return ids
	})
	return { connected, threads, runners, current, openThread, family }
})

export const forkedFrom = (t) => t?.conversation?.parent?.conversationId
export const titleOf = (id) => threads.find((t) => t.id === id)?.title || `thread ${id}`
export const fork = async (id, at) => openThread((await api(`/api/threads/${id}/fork`, { at })).id)
