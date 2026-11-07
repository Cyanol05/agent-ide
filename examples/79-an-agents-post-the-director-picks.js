/** MODULES=+director with picks: an agent's `post` to a thread of bots, with no `to`, asks whom the director picks, as a person's message does */
import { answered, api, call, check, done, say, scriptedRunner, server, text, until, view } from './lib.js'

await server({ MODULES: '+bots,+director', DIRECTOR_MODEL: 'echo/echo@laptop' })
await scriptedRunner('laptop', (request) => {
	const system = text(request.messages.find((m) => m.role === 'system') ?? { content: '' })
	const last = request.messages.at(-1)
	if (system.startsWith('You choose who answers')) {
		const message = text(last).match(/New message: \[[^\]]+\] (.*)/)?.[1] ?? ''
		return say(message.includes('roses') ? 'Kira: she knows roses' : 'nobody: nothing for them')
	}
	if (last.role === 'toolResult') return say('')
	const told = text(last)
	const garden = told.match(/ask garden (\d+)/)?.[1]
	if (garden) return call('post', { thread: Number(garden), body: 'how do I prune roses?' })
	return say(`heard: ${told.slice(-40)}`)
})
await api('POST', '/api/bots', { name: 'Kira', to: 'echo/echo@laptop', instructions: 'A gardener.' })
await api('POST', '/api/bots', { name: 'Ada', to: 'echo/echo@laptop' })

const garden = (await api('POST', '/api/threads', { title: 'garden' })).json.id
await api('POST', `/api/threads/${garden}/entries`, { body: 'hello', to: ['Ada', 'Kira'] })
await answered(garden, 2)

const home = (await api('POST', '/api/threads', { title: 'home' })).json.id
await api('POST', `/api/threads/${home}/entries`, {
	body: `ask garden ${garden}`,
	to: 'echo/echo@laptop',
})
const posted = await until(async () =>
	(await view(garden)).entries.find((entry) => entry.data.from === home),
)
check(
	JSON.stringify(posted?.data.to) === '["Kira"]' && posted.data.picked === 'she knows roses',
	"an agent's post that names no one asks whom the director picks, not whom the thread asked last",
	JSON.stringify(posted?.data),
)
await answered(garden, 3)

await api('DELETE', '/api/bots/Kira')
await api('DELETE', '/api/bots/Ada')
done()
