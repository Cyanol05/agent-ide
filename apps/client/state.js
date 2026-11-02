// What the client knows, and every call that changes it. Components read it; only this file writes it or talks to
// the server, and every change ends in changed(), which draws the page again.
import { drawer } from './dom.js'
import { parseAgent } from './agent.js'

export const params = new URLSearchParams(location.search)
// The server that served this page, or another with ?server=.
export const url =
	params.get('server') ||
	(location.protocol === 'file:' ? 'http://127.0.0.1:3000' : location.origin)
export const me = params.get('user') || 'you'

export let connected = false,
	runners = [],
	threads = [],
	modules = null, // the server's, asked until it answers: they don't change while it runs
	bots = [] // with the bots module: each bot's name, home thread, recipe and instructions
export let current = Number(params.get('thread')) || null // the thread on screen
export const entries = new Map() // thread id → its entries, as the thread's socket sends them
export const doing = new Map() // `${thread} ${agent}` → what that agent is doing right now
export let newThreadTools = null // the tools a new thread starts with, as `pi --tools` takes them
export let wantsFocus = false // the next render puts the cursor in the composer

const listeners = new Set()
export const onChange = (f) => listeners.add(f)
export const changed = () => {
	for (const f of listeners) f()
}

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

// Questions about what it knows.
export const titleOf = (id) => threads.find((t) => t.id === id)?.title || `thread ${id}`
// Pi records where a fork came from.
export const forkedFrom = (t) => t?.conversation?.parent?.conversationId
export const homeBot = (id) => bots.find((b) => b.home === id)
// A bot asked by name is its recipe under its name, so a pick is one shape whoever it asks.
export const botAgent = (b) => ({ ...b.to, name: b.name })
// A bot's color comes from its name, the same in every client.
const hue = (name) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
export const colorOf = (author) =>
	bots.some((b) => b.name === author) ? `color: oklch(0.6 0.14 ${hue(author)})` : ''
// Who's in a thread, as the server says it: the people who wrote there, not as an agent's answer or a post from
// elsewhere, and who read it.
export const peopleIn = (id) => [
	...new Set([
		...(entries.get(id) ?? [])
			.filter((e) => !e.data.answer && !e.data.error && !e.data.from)
			.map((e) => e.data.author),
		...(threads.find((t) => t.id === id)?.readers ?? []),
	]),
]
// The thread on screen and its family: what it forked from, the threads its agents started, and theirs.
export function family() {
	if (!current) return []
	const byId = new Map(threads.map((t) => [t.id, t]))
	const parent = (id) => byId.get(id)?.parent ?? forkedFrom(byId.get(id))
	let root = current
	for (let n = 0; parent(root) && byId.has(parent(root)) && n < 20; n++) root = parent(root)
	const out = [root]
	for (let i = 0; i < out.length; i++)
		for (const t of threads)
			if (parent(t.id) === out[i] && !out.includes(t.id) && !t.hidden) out.push(t.id)
	if (!out.includes(current)) out.push(current)
	return out.filter((id) => byId.has(id))
}
// A name alone is that agent in this thread, or a bot; anything else is model:thinking@runner.
export function resolveAgent(text) {
	const there = threads.find((t) => t.id === current)?.agents.find((a) => a.name === text)
	if (there?.to) return there.to
	const bot = bots.find((b) => b.name === text)
	return bot ? botAgent(bot) : parseAgent(text)
}

// Whom the next message asks: your picks, the same as the line under the composer. Typed there, the line stays as
// you wrote it; picked anywhere else, it's written again from the picks.
export let picks = [],
	picksTyped = false
export const choose = (next, typed = false) => {
	picks = next
	picksTyped = typed
	changed()
}
// At a bot's home the bot, anywhere else your picks.
export const recipients = () => (homeBot(current) ? [botAgent(homeBot(current))] : picks)
// What each runner's card is set to: the model and thinking it asks with, kept when it's not picked. A named pick,
// such as a bot, is an agent of its own there, not the card's.
export const runnerSettings = {}
export const pickOn = (r) => picks.find((p) => p.runner === r.name && !p.name)
export const settingFor = (r) => {
	const p = pickOn(r)
	// Low thinking unless you turn it up: quick answers suit a page you play with.
	return p
		? { model: p.model, thinkingLevel: p.thinkingLevel, dir: p.dir }
		: (runnerSettings[r.name] ?? { model: r.model, thinkingLevel: 'low' })
}
export function tune(r, change) {
	const next = Object.fromEntries(Object.entries({ ...settingFor(r), ...change }).filter(([, v]) => v))
	runnerSettings[r.name] = next
	if (pickOn(r)) choose(picks.map((p) => (p === pickOn(r) ? { runner: r.name, ...next } : p)))
	else changed()
}
// Ask this runner, or with also, ask it too, or stop asking it.
export function pickRunner(r, also) {
	const self = { runner: r.name, ...settingFor(r) }
	const on = pickOn(r)
	if (!also) return choose([self])
	if (!on) return choose([...picks, self])
	if (picks.length > 1) choose(picks.filter((p) => p !== on))
}

export function openThread(id) {
	current = id
	drawer(null)
	const next = new URL(location.href)
	if (id) next.searchParams.set('thread', id)
	else next.searchParams.delete('thread')
	history.replaceState(null, '', next)
	wantsFocus = true
	refresh()
}
export const focused = () => (wantsFocus = false)
export const setNewThreadTools = (tools) => {
	newThreadTools = tools
	changed()
}

// Calls to the server.
export async function ask(body, to = recipients()) {
	if (!to.length) return
	if (!current) {
		const { id } = await api('/api/threads', {
			title: body.slice(0, 60),
			...(newThreadTools ? { tools: newThreadTools } : {}),
		})
		newThreadTools = null
		openThread(id)
	}
	await api(`/api/threads/${current}/entries`, { body, to })
	refresh()
}
export async function fork(id, at) {
	openThread((await api(`/api/threads/${id}/fork`, { at })).id)
}
// Hides it; Pi keeps everything.
export async function deleteThread(id) {
	await fetch(`${url}/api/threads/${id}`, { method: 'DELETE', headers: { 'x-user': me } })
	if (family().includes(id)) openThread(null)
	else refresh()
}
export const setThreadTools = (tools) => api(`/api/threads/${current}/tools`, { tools }).then(refresh)
export const saveBot = (change) =>
	api('/api/bots', change)
		.then(refresh)
		.catch((error) => alert(error.message))
export const setBotModel = (name, to) => api('/api/bots', { name, to })
export async function createBot(name, to) {
	const { home } = await api('/api/bots', { name, to })
	bots = await api('/api/bots')
	openThread(home)
}
export async function forgetBot(name) {
	await fetch(`${url}/api/bots/${name}`, { method: 'DELETE', headers: { 'x-user': me } })
	refresh()
}

// Fetches what changed; the server says when over /ws.
let fetching = null,
	again = false
export async function refresh() {
	if (fetching) return void (again = true)
	fetching = (async () => {
		const [r, t] = await Promise.all([
			api('/api/runners').catch(() => null),
			api('/api/threads').catch(() => null),
		])
		connected = Boolean(r)
		runners = r ?? []
		threads = t ?? []
		modules ??= (await api('/api/server').catch(() => null))?.modules ?? null
		bots = modules?.includes('bots') ? await api('/api/bots').catch(() => bots) : []
		// A thread that's gone, deleted here or elsewhere, leaves a new one in its place.
		if (t && current && !threads.some((x) => x.id === current)) current = null
		const home = runners.find((x) => x.online) ?? runners[0]
		if (!picks.length && home?.model) {
			picks = [{ runner: home.name, ...settingFor(home) }]
			picksTyped = false
		}
		watchThreads()
		changed()
	})()
	await fetching
	fetching = null
	if (again) {
		again = false
		refresh()
	}
}

// One socket hears that something changed; one per thread on screen streams its entries and what its agents are doing.
export function watchServer() {
	const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
	socket.onopen = refresh
	socket.onmessage = refresh
	socket.onclose = () => {
		connected = false
		changed()
		setTimeout(watchServer, 1000)
	}
}
const watchers = new Map()
function watchThreads() {
	const shown = new Set(family())
	for (const [id, socket] of watchers)
		if (!shown.has(id)) {
			socket.onclose = null
			socket.close()
			watchers.delete(id)
		}
	for (const id of shown) {
		if (watchers.has(id)) continue
		const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
		socket.onopen = () => socket.send(JSON.stringify({ watch: id }))
		socket.onmessage = (m) => {
			const { thread, agent, live, entries: more } = JSON.parse(m.data)
			if (live) doing.set(`${thread} ${agent}`, live)
			// A socket opened again sends every entry again; each is kept once.
			if (more) {
				const had = entries.get(thread) ?? []
				const seen = new Set(had.map((e) => e.id))
				entries.set(thread, [...had, ...more.filter((e) => !seen.has(e.id))])
			}
			changed()
		}
		socket.onclose = () => {
			watchers.delete(id)
		}
		watchers.set(id, socket)
	}
}
