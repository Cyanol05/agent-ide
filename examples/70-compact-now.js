/** Compacting by hand works however much room is left; with memory, the thread's memory is the summary, and a thread view says each agent's context window */
import {
	answered,
	api,
	check,
	conversationOf,
	done,
	linesOf,
	say,
	scriptedRunner,
	server,
	text,
	until,
} from './lib.js'

const route = (request) => {
	const first = text(request.messages.find((m) => m.role === 'user'))
	return say(first.includes('<input>') ? `L ${'x'.repeat(298)}` : 'ok')
}
const agent = { runner: 'bot', model: 'echo/echo' }

const srv = await server({ MODULES: '+memory' })
await scriptedRunner('bot', route)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'roomy' })
const say_ = (body, to = null) => api('POST', `/api/threads/${id}/entries`, { body, to })
// Pi keeps the newest 20,000 tokens verbatim, so the thread must hold more than that
for (let k = 0; k < 30; k++) await say_(`message ${k} ${'z'.repeat(4000)}`)
await say_('go A', agent)
await answered(id, 1, 20000)
for (let k = 0; k < 30; k++) await say_(`message ${k} ${'y'.repeat(4000)}`)
await say_('go B', agent)
await answered(id, 2, 20000)
await until(async () => (await linesOf(id)).filter((x) => x.l === 0).length >= 64, 60000, 200)

const before = await conversationOf(
	await api('GET', `/api/threads/${id}`).then((r) => r.json),
	'echo/echo@bot',
)
check(
	!before?.entries.some((e) => e.kind === 'pi.compaction'),
	'with room to spare, nothing is compacted',
)

const { json, status } = await api('POST', `/api/threads/${id}/compact`, {})
check(
	status < 300 && json.compacted?.length === 1,
	'compacting by hand answers for the thread’s agent',
	status + JSON.stringify(json),
)

const after = await conversationOf((await api('GET', `/api/threads/${id}`)).json, 'echo/echo@bot')
const compaction = after?.entries.find((e) => e.kind === 'pi.compaction')
check(
	JSON.stringify(compaction ?? '').includes('<chat>'),
	"the agent's conversation now holds the memory as its summary",
	JSON.stringify(compaction)?.slice(0, 200),
)

const row = (await api('GET', `/api/threads/${id}`)).json
check(
	row.agents[0].contextWindow > 0,
	'the thread view says the agent’s context window',
	JSON.stringify(row.agents[0]),
)

srv.kill()
done()
