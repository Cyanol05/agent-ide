/** A browser watching a thread hears its messages, its newest page first, earlier pages when it asks, then each as it lands, and what each agent is doing as it changes */
import {
	fauxAssistantMessage,
	fauxThinking,
	fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import {
	answered,
	api,
	base,
	conversationOf,
	check,
	done,
	kill,
	say,
	scriptedRunner,
	server,
	until,
	view,
	text,
} from './lib.js'

let srv = await server()
const long = `done ${'and more '.repeat(60)}`
const bot = await scriptedRunner('bot', (request) =>
	request.messages.some((m) => m.role === 'toolResult')
		? say(long)
		: fauxAssistantMessage(
				[
					fauxThinking('first the folder'),
					fauxToolCall('bash', { command: 'sleep 0.5; echo slept' }),
				],
				{ stopReason: 'toolUse' },
			),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'live' })

/** Every message the socket hears for the thread, in order: `{entries}`, or an agent's `{agent, live}` and `{agent, entries}` */
function watch(thread) {
	const heard = []
	const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`)
	socket.onmessage = ({ data }) => {
		const m = JSON.parse(data)
		if (m.thread === thread) heard.push(m)
	}
	socket.onopen = () => socket.send(JSON.stringify({ watch: thread }))
	return {
		heard,
		earlier: (all) => socket.send(JSON.stringify({ earlier: thread, all })),
		close: () => socket.close(),
	}
}
// Live work is keyed by the agent's conversation, which stays as it switches model or runner
const lives = (heard) => heard.filter((m) => m.live).map((m) => m.live)
const said = (heard) =>
	heard.flatMap((m) => (m.agent ? [] : (m.entries ?? []))).map((e) => e.data.body)

const first = watch(id)
await until(async () => first.heard.length)
check(
	JSON.stringify(first.heard) ===
		JSON.stringify([{ thread: id, entries: [], earlier: false, people: [] }]),
	'a new thread says first that it has no messages, none before them, no people and no agents',
	JSON.stringify(first.heard),
)
const {
	json: { entry },
} = await api('POST', `/api/threads/${id}/entries`, {
	body: 'work',
	to: { runner: 'bot', model: 'echo/echo' },
})
check(
	Boolean(await until(async () => lives(first.heard).length, 8000, 20)),
	'an agent the thread asks is followed from then on',
)

/** Joining mid-run, the first word shows the running tool call and what it runs */
const running = (live) =>
	live.run && live.tools.some((t) => t.name === 'bash' && t.status === 'running')
await until(async () => lives(first.heard).some(running), 8000, 20)
const late = watch(id)
const joined = await until(async () => lives(late.heard)[0], 8000, 20)
check(
	running(joined) && joined.tools[0].args?.command?.includes('sleep'),
	'joining mid-run, the agent is running its tool call, with its arguments',
	JSON.stringify(joined)?.slice(0, 300),
)
late.close()

const v = await answered(id)
check(v?.entries.at(-1)?.data.body === long, 'the answer lands in the thread')
check(
	JSON.stringify(await until(async () => said(first.heard).length === 2 && said(first.heard))) ===
		JSON.stringify(['work', long]),
	'and the socket sent each message once, as it landed',
	JSON.stringify(said(first.heard).map((b) => b.slice(0, 20))),
)
const heard = lives(first.heard)
const lengths = [...new Set(heard.map((l) => text(l.message).length).filter(Boolean))]
check(
	lengths.length > 1 && lengths.every((n, i) => !i || n > lengths[i - 1]),
	'its reply grows in several updates before the answer lands',
	JSON.stringify(lengths),
)
check(
	await until(async () => {
		const last = lives(first.heard).at(-1)
		return !last.run && !last.message
	}),
	'and once it answered, the agent is idle',
	JSON.stringify(lives(first.heard).at(-1))?.slice(0, 200),
)

// Conversation entries arrive once, with thinking and tool output before the run ends.
const streamed = []
let working = false
for (const message of first.heard) {
	if (message.live) working = message.live.run
	if (message.agent && message.entries)
		streamed.push(...message.entries.map((entry) => ({ entry, working })))
}
check(
	streamed.some(
		({ entry, working }) =>
			working && entry.model?.[0]?.content?.some((block) => block.type === 'thinking'),
	),
	'its thinking arrives while it still works',
)
check(
	streamed.some(
		({ entry, working }) =>
			working &&
			entry.model?.[0]?.role === 'toolResult' &&
			/slept/.test(JSON.stringify(entry.model)),
	),
	"the tool's output arrives before the turn ends",
)
check(
	new Set(streamed.map(({ entry }) => entry.id)).size === streamed.length,
	'each conversation entry comes once',
)
const delivery = streamed.find(({ entry }) => entry.kind === 'ade.delivery')?.entry
check(
	delivery &&
		heard
			.filter((live) => live.run)
			.every((live) => live.delivery?.id === delivery.id && live.delivery.held.includes(entry)),
	'every working update names its delivery and the messages it held',
)
check(
	heard.filter((live) => !live.run).every((live) => live.delivery === undefined),
	'an idle agent names no delivery',
)

const from = first.heard.length
await api('POST', `/api/threads/${id}/entries`, { body: 'again' })
await answered(id, 2)
await until(async () => {
	const last = lives(first.heard.slice(from)).at(-1)
	return last && !last.run
})
const next = (await conversationOf(await view(id), 'echo/echo@bot')).entries.findLast(
	(entry) => entry.kind === 'ade.delivery',
)
const nextLives = lives(first.heard.slice(from)).filter((live) => live.run)
check(
	next.id > delivery.id &&
		nextLives.length > 0 &&
		nextLives.every((live) => live.delivery?.id === next.id),
	'the next turn names its own delivery',
)

/** A burst bigger than Pi's window still arrives whole, in order, each message once */
const burst = Array.from({ length: 250 }, (_, i) => `note ${i}`)
await Promise.all(
	burst.map((body) => api('POST', `/api/threads/${id}/entries`, { body, to: null })),
)
const notes = await until(async () => {
	const got = said(first.heard).filter((b) => b.startsWith('note '))
	return got.length >= burst.length && got
})
check(
	notes?.length === burst.length && new Set(notes).size === burst.length,
	'a burst of 250 messages arrives whole, each once',
	`${notes?.length ?? said(first.heard).length}`,
)
first.close()

await kill(srv, 'SIGKILL')
srv = await server()
const restarted = watch(id)
const now = await until(async () => lives(restarted.heard)[0], 8000, 20)
// A long thread opens on its newest page; each earlier one comes when asked, the agent's turns for it first
const opened = restarted.heard[0]
check(
	opened.earlier === true &&
		opened.entries.length >= 50 &&
		opened.entries.length < burst.length &&
		opened.entries.every((entry) => entry.data.body.startsWith('note ')),
	'after a restart, watching again starts with the newest page and says there are messages before it',
	`${opened.entries.length} ${opened.earlier}`,
)
const pages = [opened.entries]
for (let more = true; more;) {
	const from = restarted.heard.length
	restarted.earlier()
	const page = await until(async () => restarted.heard.slice(from).find((m) => m.older && !m.agent))
	if (!page) break
	pages.unshift(page.entries)
	more = page.earlier
}
const paged = pages.flat().map((entry) => entry.data.body)
check(
	JSON.stringify(paged.slice(0, 4)) === JSON.stringify(['work', long, 'again', long]) &&
		JSON.stringify(paged.slice(4).sort()) === JSON.stringify([...burst].sort()) &&
		pages.length > 2,
	'asked for earlier pages, it brings the rest, each message once, until none is left',
	`${pages.length} pages, ${paged.length} messages`,
)
const turns = restarted.heard.filter((m) => m.agent && m.entries).flatMap((m) => m.entries)
check(
	turns.filter((entry) => entry.kind === 'ade.delivery').length === 2 &&
		restarted.heard.findIndex((m) => m.agent && m.older) <
			restarted.heard.findLastIndex((m) => m.older && !m.agent),
	"the agent's turns for the earlier messages come before them",
)
const again = watch(id)
await until(async () => again.heard.length)
again.earlier(true)
const rest = await until(async () => again.heard.find((m) => m.older && !m.agent))
check(
	rest?.earlier === false &&
		JSON.stringify([...rest.entries, ...again.heard[0].entries].map((entry) => entry.data.body)) ===
			JSON.stringify(paged),
	'asked for all of it, the rest comes at once',
)
again.close()
check(
	now && !now.run && !now.tools.length,
	'after a restart, watching again says the agent is idle',
)
restarted.close()
bot.close()
done()
