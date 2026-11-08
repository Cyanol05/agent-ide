/** With memory on, a thread with a bot in it remembers and one without doesn't, unless `memory.threads` or its own switch says otherwise */
import { answered, api, check, done, linesOf, say, scriptedRunner, server, sleep, until } from './lib.js'

await server({ MODULES: '+memory,+bots' })
await scriptedRunner('bot', () => say('ok'))
await api('POST', '/api/bots', { name: 'ada', to: 'echo/echo@bot' })
const thread = async (title) => (await api('POST', '/api/threads', { title })).json.id
const row = async (id) => (await api('GET', '/api/threads')).json.find((thread) => thread.id === id)

check(
	(await api('GET', '/api/server')).json.settings.memory.threads === 'bots',
	'by default, memory remembers the threads with a bot in them',
)

const withBot = await thread('with ada')
const alone = await thread('alone')
await api('POST', `/api/threads/${alone}/entries`, { body: 'nobody asked', to: null })
await api('POST', `/api/threads/${alone}/entries`, { body: 'the agent asked', to: ['echo/echo@bot'] })
await api('POST', `/api/threads/${withBot}/entries`, { body: 'hello ada', to: ['ada'] })
await answered(alone, 1)
await answered(withBot, 1)
check(
	Boolean(await until(async () => (await linesOf(withBot)).length >= 2)),
	'a thread with a bot gets its lines',
)
await sleep(300)
check(
	(await linesOf(alone)).length === 0 && (await row(alone)).memory === false,
	'a thread with only its own agent gets none',
	JSON.stringify(await linesOf(alone)),
)
check((await row(withBot)).memory === true, 'the thread list says which remembers')

await api('POST', `/api/threads/${alone}/memory`, { on: true })
check(
	Boolean(await until(async () => (await linesOf(alone)).length >= 3)),
	'switched on, a thread writes the lines it missed',
	JSON.stringify(await linesOf(alone)),
)
await api('POST', `/api/threads/${alone}/entries`, { body: 'and now', to: null })
check(
	Boolean(await until(async () => (await linesOf(alone)).length >= 4)),
	'and every line after',
)

await api('POST', `/api/threads/${withBot}/memory`, { on: false })
const before = (await linesOf(withBot)).length
await api('POST', `/api/threads/${withBot}/entries`, { body: 'forget this, ada', to: ['ada'] })
await answered(withBot, 2)
await sleep(300)
check(
	(await linesOf(withBot)).length === before && (await row(withBot)).memory === false,
	'switched off, a thread with a bot writes no more',
)
done()
