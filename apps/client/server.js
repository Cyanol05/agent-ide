/** The server, as this client sees it: lists over HTTP, changes over /ws */
import {
	createEffect,
	createMemo,
	createProjection,
	createRoot,
	createSignal,
	createStore,
	latest,
	onSettled,
	refresh,
	untrack,
} from 'solid-js'

export const params = new URLSearchParams(location.search)
export const url = params.get('server') || location.origin
export const me = params.get('user') || 'you'
export const api = (path, body, method = body === undefined ? 'GET' : 'POST') =>
	fetch(url + path, {
		headers: { 'Content-Type': 'application/json', 'x-user': me },
		method,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	}).then(async (response) => {
		const json = await response.json()
		if (!response.ok) throw new Error(json.error)
		return json
	})

/** A socket belongs to its caller; disposing it also cancels a pending reconnect. */
export function watch(receive, opened = () => {}, closed = () => {}) {
	let socket, timer
	const connect = () => {
		socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
		socket.onopen = () => opened(socket)
		socket.onmessage = (event) => receive(JSON.parse(event.data))
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
export const [connected, setConnected] = createSignal(false)
export const [newThreadTools, setNewThreadTools] = createSignal(null)
/** The last key this page made, {name, connect}: the key is shown once, so it outlives the form that asked */
export const [minted, setMinted] = createSignal(null)
/** Each thread's messages. They never change once written, so the store is shallow: a read tracks the thread's list, not each message's fields */
export const [entries, setEntries] = createStore({}, { shallow: true })
/** Who's in each thread on screen, as its socket says */
export const [people, setPeople] = createStore({})
export const [current, setCurrent] = createSignal(Number(params.get('thread')) || null)

/** A thread's address: what a real link needs, so it can also be opened in a new tab or copied */
export function hrefOf(id) {
	const next = new URL(location.href)
	if (id) next.searchParams.set('thread', id)
	else next.searchParams.delete('thread')
	return next.pathname + next.search
}

export function openThread(id) {
	setCurrent(id)
	drawer(null)
	history.replaceState(null, '', hrefOf(id))
}

/** A link to a thread opens it here, and still opens in a new tab or window when the click asks for one */
export function followThread(event, id) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
	event.preventDefault()
	openThread(id)
}

export const { threads, runners, server, bots, family, columns, closeColumn } = createRoot(() => {
	const server = createMemo(() => api('/api/server'))
	const bots = createProjection(
		() => (server().modules.includes('bots') ? api('/api/bots') : []),
		[],
		{ key: 'name' },
	)
	const threads = createProjection(() => api('/api/threads'), [], { key: 'id' })
	const runners = createProjection(() => api('/api/runners'), [], { key: 'name' })
	const reload = () => {
		refresh(threads)
		refresh(runners)
		refresh(bots)
	}
	onSettled(() =>
		watch(
			reload,
			() => {
				setConnected(true)
				refresh(server)
				reload()
			},
			() => setConnected(false),
		),
	)
	/** The open thread's family, as the server sends it: one thread until the list has it, `[null]` for a new one */
	const family = createMemo(() =>
		current()
			? (threads.find((thread) => thread.id === current())?.family.map((member) => member.id) ?? [
					current(),
				])
			: [null],
	)
	/** Family members you opened in this page; closing forgets one */
	const [open, setOpen] = createSignal(new Set())
	createEffect(current, (here) => {
		if (here && !untrack(open).has(here)) setOpen((ids) => new Set([...ids, here]))
	})
	/** The columns on screen: the thread you're in and the open members of its family, in the family's order */
	const columns = createMemo(() => family().filter((id) => id === current() || open().has(id)))
	/** Closing the thread you're in moves you to its nearest open neighbour, or to a new thread when it was alone */
	const closeColumn = (id) => {
		if (id === current()) {
			const shown = columns()
			const at = shown.indexOf(id)
			openThread(shown[at + 1] ?? shown[at - 1] ?? null)
		}
		setOpen((ids) => {
			const next = new Set(ids)
			next.delete(id)
			return next
		})
	}
	return { threads, runners, server, bots, family, columns, closeColumn }
})

export function drawer(which) {
	for (const name of ['list', 'side'])
		document.body.classList.toggle(name, name === which && !document.body.classList.contains(name))
}
export async function createThread(title) {
	const tools = newThreadTools()
	const { id } = await api('/api/threads', { title, tools })
	if (latest(newThreadTools) === tools) setNewThreadTools(null)
	if (!latest(current)) openThread(id)
	return id
}
export async function deleteThread(id) {
	await api(`/api/threads/${id}`, undefined, 'DELETE')
	if (family().includes(id)) openThread(null)
	refresh(threads)
}
export const homeBot = (id) => bots.find((bot) => bot.home === id)
export const botAgent = (bot) => ({ ...bot.to, name: bot.name })
export const colorOf = (name) => {
	const hue = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7)
	return bots.some((bot) => bot.name === name) ? `color: oklch(0.6 0.14 ${hue})` : ''
}
export const forkedFrom = (thread) => thread?.conversation?.parent?.conversationId
export const titleOf = (id) => threads.find((thread) => thread.id === id)?.title || `thread ${id}`
export const fork = async (id, at) => openThread((await api(`/api/threads/${id}/fork`, { at })).id)
