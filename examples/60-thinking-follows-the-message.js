/** luna:low, luna:medium and luna:high are one agent; the thinking each message names applies from that message on */
import { answered, api, check, done, say, scriptedRunner, server, view } from './lib.js'

await server()
const ran = []
await scriptedRunner(
	'x',
	(context, options) => {
		ran.push(options?.reasoning ?? 'off')
		return say(`thinking ${options?.reasoning ?? 'off'}`)
	},
	{ model: { reasoning: true } },
)

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'thinking' })
const ask = async (n, to, body = 'go') => {
	await api('POST', `/api/threads/${id}/entries`, { body, to })
	return answered(id, n)
}

// As the composer sends them; pi on a real runner reads luna:high@x the same way
const luna = (thinkingLevel) => ({ runner: 'x', model: 'echo/echo', thinkingLevel })
await ask(1, luna('low'), 'you are low')
await ask(2, luna('medium'), 'medium')
let v = await ask(3, luna('high'), 'who are you')
check(
	v.agents.length === 1,
	'three levels of one model reach one agent',
	v.agents.map((a) => a.name).join(),
)
check(ran.join() === 'low,medium,high', 'each message runs with the thinking it names', ran.join())
check(v.agents[0].to.thinkingLevel === 'high', 'the thread shows the agent at its new level')

// Its name, or the model without a level, keeps the level it has
await ask(4, 'echo/echo@x')
await ask(5, { runner: 'x', model: 'echo/echo' })
v = await view(id)
check(
	ran.slice(3).join() === 'high,high' && v.agents[0].to.thinkingLevel === 'high',
	'naming no level changes nothing',
	ran.join(),
)

done()
