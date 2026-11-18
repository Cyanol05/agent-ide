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
		const found = localStorage.getItem(`ade.${key}`)
		return found === null ? fallback : JSON.parse(found)
	} catch {
		return fallback
	}
}
const cache = (key, value) => {
	try {
		localStorage.setItem(`ade.${key}`, JSON.stringify(value))
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
/** Whether a thread has messages before the ones on screen, which come a page at a time as you scroll up */
export const [earlier, setEarlier] = createStore({})
/** Each watched thread's way to ask for its page before the ones it has, or all of them; answers once they're in */
export const pagers = new Map()
export const loadEarlier = (thread, all = false) =>
	earlier[thread] ? (pagers.get(thread)?.(all) ?? Promise.resolve()) : Promise.resolve()
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
	document.body.classList.toggle(
		'list',
		which === 'list' && !document.body.classList.contains('list'),
	)
}

export const {
	threads,
	archivedThreads,
	runners,
	server,
	bots,
	threadOf,
	family,
	columns,
	closeColumn,
	reloadThreads,
	reloadArchivedThreads,
	reloadBots,
	changeThread,
	removeRow,
} = createRoot(() => {
	const [server, setServer] = createSignal(cached('server', DEFAULT_SERVER))
	const [bots, setBots] = createStore(cached('bots', []))
	const [threads, setThreads] = createStore(cached('threads', []))
	const [archivedThreads, setArchivedThreads] = createStore([])
	const [runners, setRunners] = createStore(cached('runners', []))
	/** Each fetch keeps its row's identity when nothing in it changed, so a keyed `For` leaves it alone; an answer older than the one already shown is dropped */
	const reloadServer = () =>
		api('/api/server').then((data) => {
			setServer(data)
			cache('server', data)
		})
	const answered = {}
	const reloadList = (path, show, cacheKey = path, enabled = true) => {
		const asked = performance.now()
		return (enabled ? api(`/api/${path}`) : Promise.resolve([])).then((data) => {
			if (asked < (answered[path] ?? 0)) return
			answered[path] = asked
			show(data)
			if (cacheKey) cache(cacheKey, data)
		})
	}
	/** Rows you removed that the server hasn't confirmed, by list; every fetch leaves them out until it does */
	const leaving = { bots: new Set(), runners: new Set() }
	let fetchedBots = cached('bots', [])
	let fetchedRunners = cached('runners', [])
	const showBots = () =>
		setBots(
			reconcile(
				fetchedBots.filter((bot) => !leaving.bots.has(bot.name)),
				'name',
			),
		)
	const showRunners = () =>
		setRunners(
			reconcile(
				fetchedRunners.filter((runner) => !leaving.runners.has(runner.name)),
				'name',
			),
		)
	const reloadBots = () =>
		reloadList(
			'bots',
			(data) => {
				fetchedBots = data
				showBots()
			},
			'bots',
			untrack(server).modules.includes('bots'),
		)
	const reloadRunners = () =>
		reloadList('runners', (data) => {
			fetchedRunners = data
			showRunners()
		})
	/** Changes to a thread's row (archived, title) that the server hasn't confirmed; both lists show them over every fetch until it does */
	const pending = new Map()
	let fetchedThreads = cached('threads', [])
	let fetchedArchived = []
	const showThreads = () => {
		const fresh = new Set(fetchedThreads.map((row) => row.id))
		const rows = [...fetchedThreads, ...fetchedArchived.filter((row) => !fresh.has(row.id))]
			.map((row) => (pending.has(row.id) ? { ...row, ...pending.get(row.id) } : row))
			.sort((a, b) => b.id - a.id)
		setThreads(
			reconcile(
				rows
					.filter((row) => !row.archived)
					.map((row) => (row.family ? row : { ...row, family: [{ id: row.id, depth: 0 }] })),
				'id',
			),
		)
		setArchivedThreads(
			reconcile(
				rows.filter((row) => row.archived),
				'id',
			),
		)
	}
	const reloadThreads = () =>
		reloadList('threads', (data) => {
			fetchedThreads = data
			showThreads()
		})
	/** Its own fetch; the main list never carries archived threads */
	const reloadArchivedThreads = () =>
		reloadList(
			'threads/archived',
			(data) => {
				fetchedArchived = data
				showThreads()
			},
			null,
		)
	/** Shows a change to a thread's row at once, then asks the server; a refusal puts the row back and throws */
	const changeThread = async (id, change, request) => {
		const mine = { ...pending.get(id), ...change }
		pending.set(id, mine)
		showThreads()
		const settle = () => {
			if (pending.get(id) === mine) pending.delete(id)
			showThreads()
		}
		try {
			await request()
		} catch (failure) {
			settle()
			throw failure
		}
		await Promise.all([reloadThreads(), reloadArchivedThreads()]).finally(settle)
	}
	/** Takes a bot or runner row away at once, then asks the server; a refusal puts it back and throws */
	const removeRow = async (list, name, request) => {
		const show = list === 'bots' ? showBots : showRunners
		leaving[list].add(name)
		show()
		const settle = () => {
			leaving[list].delete(name)
			show()
		}
		try {
			await request()
		} catch (failure) {
			settle()
			throw failure
		}
		await (list === 'bots' ? reloadBots() : reloadRunners()).finally(settle)
	}
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
	const threadOf = (id) => threads.find((thread) => thread.id === id)
	/** The open thread's family, as the server sends it: one thread until the list has it, `[null]` for a new one */
	const family = createMemo(() =>
		current() ? (threadOf(current())?.family.map((member) => member.id) ?? [current()]) : [null],
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
		threadOf,
		family,
		columns,
		closeColumn,
		reloadThreads,
		reloadArchivedThreads,
		reloadBots,
		changeThread,
		removeRow,
	}
})

export async function createThread(title) {
	const tools = newThreadTools()
	const { id } = await api('/api/threads', { title, tools })
	if (latest(newThreadTools) === tools) setNewThreadTools(null)
	if (!latest(current)) openThread(id)
	return id
}
/** The row moves the moment you ask; if the server refuses, it moves back and this throws why */
export function archiveThread(id, archived) {
	if (archived && family().includes(id)) openThread(null)
	return changeThread(id, { archived }, () => api(`/api/threads/${id}/archive`, { archived }))
}
export const renameThread = (id, title) =>
	changeThread(id, { title }, () => api(`/api/threads/${id}/title`, { title }))
export const forgetBot = (name) =>
	removeRow('bots', name, () => api(`/api/bots/${encodeURIComponent(name)}`, undefined, 'DELETE'))
export const revokeRunner = (name) =>
	removeRow('runners', name, () =>
		api(`/api/runners/${encodeURIComponent(name)}`, undefined, 'DELETE'),
	)

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
export const titleOf = (id) => threadOf(id)?.title ?? `thread ${id}`
