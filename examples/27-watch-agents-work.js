// A browser watching a thread hears what each agent is doing as it changes: its run, the reply it's writing, and its tool
// calls with their arguments, all before the answer lands in the thread. Watching again, as after a reconnect or a
// restart, starts from what the agent is doing now.
import {
	answered,
	api,
	base,
	call,
	check,
	done,
	say,
	scriptedRunner,
	server,
	sleep,
	until,
} from './lib.js'

let srv = await server()
const long = `done ${'and more '.repeat(60)}`
const bot = await scriptedRunner('bot', (request) =>
	request.messages.some((m) => m.role === 'toolResult')
		? say(long)
		: call('bash', { command: 'sleep 1; echo slept' }),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'live' })

// Every message the socket hears for the thread, in order: `{agent, live}`.
function watch(thread) {
	const heard = []
	const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`)
	socket.onmessage = ({ data }) => {
		const m = JSON.parse(data)
		if (m.thread === thread) heard.push(m)
	}
	socket.onopen = () => socket.send(JSON.stringify({ watch: thread }))
	return { heard, close: () => socket.close() }
}
const agent = 'echo/echo@bot'
const lives = (heard) => heard.filter((m) => m.agent === agent).map((m) => m.live)
const text = (message) =>
	(message?.content ?? [])
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('')

const first = watch(id)
await sleep(300)
check(!first.heard.length, 'a thread without agents has nothing to say')
await api('POST', `/api/threads/${id}/entries`, { body: 'work', to: { runner: 'bot', model: 'echo/echo' } })
check(
	Boolean(await until(async () => lives(first.heard).length, 8000, 20)),
	'an agent the thread asks is followed from then on',
)

// Joining mid-run, the first word shows the running tool call and what it runs.
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
first.close()

// A restart closes the socket; watching the new server starts from where the agent is.
srv.kill('SIGKILL')
await sleep(500)
srv = await server()
const restarted = watch(id)
const now = await until(async () => lives(restarted.heard)[0], 8000, 20)
check(now && !now.run && !now.tools.length, 'after a restart, watching again says the agent is idle')
restarted.close()
bot.close()
done()
