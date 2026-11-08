/** With no MEMORY_MODEL, a thread's own agent writes its lines, on the runner it runs on now; before it has one, they wait */
import {
	api,
	check,
	done,
	linesOf,
	say,
	scriptedRunner,
	server,
	sleep,
	text,
	until,
} from './lib.js'

const asked = { a: 0, b: 0 }
const route = (runner) => (request) => {
	const first = text(request.messages.find((m) => m.role === 'user'))
	if (!first.includes('<input>')) return say('ok')
	asked[runner]++
	return say(`L ${'x'.repeat(298)}`)
}
const long = (k) => `message ${k} ${'y'.repeat(1000 - `message ${k} `.length)}`
const post = (id, body, to = null) => api('POST', `/api/threads/${id}/entries`, { body, to })
const level0 = async (id) => (await linesOf(id)).filter((x) => x.l === 0).length

await server()
await scriptedRunner('a', route('a'))
await scriptedRunner('b', route('b'))
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'memory' })
await api('POST', `/api/threads/${id}/memory`, { on: true })

await post(id, long(0))
await post(id, long(1))
await sleep(1500)
check(
	(await level0(id)) === 0 && asked.a + asked.b === 0,
	'with no agent in the thread, its long messages wait for their lines',
)

await post(id, 'hello', { runner: 'a', model: 'echo/echo' })
check(
	Boolean(await until(async () => (await linesOf(id)).some((x) => x.l === 1 && x.i === 0), 15000)),
	'the first agent asked writes the lines that waited, and merges them',
)
check(asked.a > 0 && asked.b === 0, 'on its own runner', JSON.stringify(asked))

const before = { ...asked }
await post(id, long(4), { runner: 'b', model: 'echo/echo' })
await until(async () => (await level0(id)) >= 5, 15000)
check(
	asked.b > before.b,
	'switched to another runner, the agent writes its next lines there',
	JSON.stringify(asked),
)
done()
