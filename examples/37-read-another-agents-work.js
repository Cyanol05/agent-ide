/** An agent reads another thread's agent's work, not just its answer */
import { answered, api, call, check, done, say, scriptedRunner, server, text } from './lib.js'

const lastOf = (request) => request.messages.findLast((m) => m.role !== 'system')
await server()
const thread = async (title) => (await api('POST', '/api/threads', { title })).json.id
const vpsThread = await thread('on the vps')
const laptopThread = await thread('on the laptop')
// On the vps
await scriptedRunner('vps', (request) =>
	lastOf(request).role === 'toolResult'
		? say('found a problem in the log')
		: call('bash', { command: 'echo "ERROR null user in /api/me (line 42)"' }),
)
// On the laptop
await scriptedRunner('laptop', (request) => {
	const last = lastOf(request)
	if (last.role === 'toolResult') return say(`read: ${text(last)}`)
	if (text(last).includes('which line'))
		return call('threads', { thread: vpsThread, agent: 'vps', query: 'null user' })
	return call('threads', { thread: vpsThread, agent: 'nobody-here' })
})

const ask = async (id, body, runner, n) => {
	await api('POST', `/api/threads/${id}/entries`, { body, to: { runner, model: 'echo/echo' } })
	return (await answered(id, n))?.entries.at(-1).data.body ?? ''
}
const summary = await ask(vpsThread, 'what fails on the vps?', 'vps', 1)
check(
	summary === 'found a problem in the log' && !summary.includes('42'),
	'the vps agent answers with only a summary',
	summary,
)

const read = await ask(laptopThread, 'which line fails?', 'laptop', 1)
check(
	read.includes('bash: ERROR null user in /api/me (line 42)'),
	"the laptop agent reads what the vps agent's bash printed, word for word, by the model it runs as",
	read,
)
check(!read.includes('said: found a problem'), 'query narrows it to what matches', read)

const wrong = await ask(laptopThread, 'and someone else?', 'laptop', 2)
check(
	wrong.includes('No agents in thread') && wrong.includes('echo@vps'),
	"an agent that isn't there is an error naming who is",
	wrong,
)
done()
