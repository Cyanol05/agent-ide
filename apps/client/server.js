/** The server, as this client sees it: lists over HTTP, changes over /ws */
import {
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	createStore,
	latest,
	onSettled,
	reconcile,
	untrack,
} from 'solid-js'

export const params = new URLSearchParams(location.search)

/** What a fresh page shows before the server has answered once; everything after comes from cache or the server */
const DEFAULT_SERVER = {
	modules: [],
	off: [],
	about: {},
	local: false,
	settings: {
		overrides: [],
		director: {},
		memory: { model: '', compactAt: null },
	},
}
/** What's on screen survives a reload: read before first paint, written after every answer */
const cached = (key, fallback) => {
	try {
		const found = localStorage.getItem(`agent-ide.${key}`)
		return found === null ? fallback : JSON.parse(found)
	} catch {
		return fallback
	}
}
const cache = (key, value) => {
	try {
		localStorage.setItem(`agent-ide.${key}`, JSON.stringify(value))
	} catch {}
}
export const url = params.get('server') || location.origin
export const me = params.get('user') || 'you'
export const api = (path, body, method = body === undefined ? 'GET' : 'POST') =>
	fetch(url + path, {
		headers: { 'Content-Type': 'application/json', 'x-user': me },
		method,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	})
		.catch((error) => {
			throw error instanceof TypeError ? new Error("Can't reach the server") : error
		})
		.then(async (response) => {
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
const [connected, setConnected] = createSignal(false)
export { connected }
export const [newThreadTools, setNewThreadTools] = createSignal(null)
/** The last key this page made, {name, connect}: the key is shown once, so it outlives the form that asked */
export const [minted, setMinted] = createSignal(null)
/** Each thread's messages. They never change once written, so the store is shallow: a read tracks the thread's list, not each message's fields */
export const [entries, setEntries] = createStore({}, { shallow: true })
/** Your message shows the moment you send it, marked `sending`, after the thread's last, until its socket brings the server's copy; `drop` takes it back when the send failed */
export function sending(thread, data) {
	const entry = {
		id: (entries[thread]?.at(-1)?.id ?? 0) + 0.9,
		sending: true,
		data: { author: me, ...data },
	}
	setEntries((all) => {
		all[thread] = [...(all[thread] ?? []), entry]
	})
	return () =>
		setEntries((all) => {
			if (all[thread]?.includes(entry)) all[thread] = all[thread].filter((one) => one !== entry)
		})
}
/** New messages into a thread's list, each once and after it; each of yours that came back replaces the oldest one you were sending with that text */
export const merged = (list, more) => {
	const have = new Set(list.map((entry) => entry.id))
	const back = more.filter((entry) => entry.data.author === me).map((entry) => entry.data.body)
	const waiting = list.filter((entry) => {
		if (!entry.sending) return false
		const at = back.indexOf(entry.data.body.trim())
		if (at === -1) return true
		back.splice(at, 1)
		return false
	})
	return [
		...list.filter((entry) => !entry.sending),
		...more.filter((entry) => !have.has(entry.id)),
		...waiting,
	]
}
export const [people, setPeople] = createStore({})
const [current, setCurrent] = createSignal(Number(params.get('thread')) || null)
export { current }

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

/** A thread's address: what a real link needs, so it can also be opened in a new tab or copied */
export function hrefOf(id) {
	const next = new URL(location.href)
	if (id) next.searchParams.set('thread', id)
	else next.searchParams.delete('thread')
	return next.pathname + next.search
}

export function drawer(which) {
	for (const name of ['list', 'side'])
		document.body.classList.toggle(name, name === which && !document.body.classList.contains(name))
}

export const {
	threads,
	archivedThreads,
	runners,
	server,
	bots,
	family,
	columns,
	closeColumn,
	reloadThreads,
	reloadArchivedThreads,
	reloadBots,
} = createRoot(() => {
	const [server, setServer] = createSignal(cached('server', DEFAULT_SERVER))
	const [bots, setBots] = createStore(cached('bots', []))
	const [threads, setThreads] = createStore(cached('threads', []))
	const [archivedThreads, setArchivedThreads] = createStore([])
	const [runners, setRunners] = createStore(cached('runners', []))
	/** Each fetch keeps its row's identity when nothing in it changed, so a keyed `For` leaves it alone */
	const reloadServer = () =>
		api('/api/server').then((data) => {
			setServer(data)
			cache('server', data)
		})
	const reloadList = (path, set, key, cacheKey = path, enabled = true) =>
		(enabled ? api(`/api/${path}`) : Promise.resolve([])).then((data) => {
			set(reconcile(data, key))
			if (cacheKey) cache(cacheKey, data)
		})
	const reloadBots = () =>
		reloadList('bots', setBots, 'name', 'bots', untrack(server).modules.includes('bots'))
	const reloadThreads = () => reloadList('threads', setThreads, 'id')
	/** Its own fetch; the main list never carries archived threads */
	const reloadArchivedThreads = () => reloadList('threads/archived', setArchivedThreads, 'id', null)
	const reloadRunners = () => reloadList('runners', setRunners, 'name')
	const reload = () => {
		reloadThreads()
		reloadArchivedThreads()
		reloadRunners()
		reloadBots()
	}
	onSettled(() => {
		reloadServer().then(reloadBots)
		reloadThreads()
		reloadArchivedThreads()
		reloadRunners()
		watch(
			reload,
			() => {
				setConnected(true)
				reloadServer().then(reload)
			},
			() => setConnected(false),
		)
	})
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
	return {
		threads,
		archivedThreads,
		runners,
		server,
		bots,
		family,
		columns,
		closeColumn,
		reloadThreads,
		reloadArchivedThreads,
		reloadBots,
	}
})

export async function createThread(title) {
	const tools = newThreadTools()
	const { id } = await api('/api/threads', { title, tools })
	if (latest(newThreadTools) === tools) setNewThreadTools(null)
	if (!latest(current)) openThread(id)
	return id
}
export async function archiveThread(id, archived) {
	await api(`/api/threads/${id}/archive`, { archived })
	if (archived && family().includes(id)) openThread(null)
	reloadThreads()
	reloadArchivedThreads()
}

export const fork = async (id, at) => openThread((await api(`/api/threads/${id}/fork`, { at })).id)

export const homeBot = (id) => bots.find((bot) => bot.home === id)
export const botAgent = (bot) => ({ ...bot.to, name: bot.name })
/**
 * The hue a bot gets unless someone picked one: golden-angle steps in the order bots were made, so the first several
 * sit far apart and a new bot changes no one's; forgetting one shifts the bots made after it that have none picked.
 */
const madeHue = (index) => Math.round(50 + index * 137.508) % 360
export const defaultHueOf = (name) => {
	const index = [...bots].sort((a, b) => a.home - b.home).findIndex((bot) => bot.name === name)
	return index < 0 ? undefined : madeHue(index)
}
export const hues = Array.from({ length: 8 }, (_, index) => madeHue(index)).sort((a, b) => a - b)
export const paint = (hue) => `light-dark(oklch(0.56 0.15 ${hue}), oklch(0.74 0.13 ${hue}))`
/** A bot's colour, as a style for `property`: the hue picked for it, else its default; anyone else has none */
export const hueOf = (name) => bots.find((bot) => bot.name === name)?.color ?? defaultHueOf(name)
export const colorOf = (name, property = 'color') => {
	const hue = hueOf(name)
	return hue === undefined ? '' : `${property}: ${paint(hue)}`
}
export const forkedFrom = (thread) => thread?.conversation?.parent?.conversationId
export const titleOf = (id) => {
	const thread = threads.find((thread) => thread.id === id)
	return thread ? thread.title : `thread ${id}`
}
