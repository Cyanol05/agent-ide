/** New agents run with pi's runner-local thinking defaults; an existing agent keeps its level. */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { api, answered, check, conversationOf, dir, done, runner, server } from './lib.js'

await server()
const pi = path.join(dir, '..', 'pi')
mkdirSync(pi)
const settings = (value) => writeFileSync(path.join(pi, 'settings.json'), JSON.stringify(value))
settings({})
// The real runner's scripted echo provider, with thinking enabled just for this example.
writeFileSync(
	path.join(pi, 'models.json'),
	JSON.stringify({
		providers: { echo: { modelOverrides: { echo: { reasoning: true } } } },
	}),
)
await runner('laptop', { env: { PI_CODING_AGENT_DIR: pi } })
const start = async (title, to = { runner: 'laptop', model: 'echo/echo' }) => {
	const id = (await api('POST', '/api/threads', { title })).json.id
	await api('POST', `/api/threads/${id}/entries`, { body: 'hello', to })
	return answered(id)
}
const checkLevel = async (thread, expected, description) => {
	const agent = thread.agents[0]
	const conversation = await conversationOf(thread, agent.name)
	// Pi records the generation request's level on the assistant message, not just in the agent's settings.
	const reply = conversation.entries
		.flatMap((entry) => entry.model ?? [])
		.findLast((message) => message.role === 'assistant')
	check(
		agent.to.thinkingLevel === expected && reply?.thinkingLevel === expected,
		description,
		JSON.stringify({ to: agent.to, run: reply?.thinkingLevel }),
	)
}
let thread = await start('pi default')
await checkLevel(thread, 'medium', 'no level runs at pi’s built-in medium, not Durable’s off')
settings({ defaultThinkingLevel: 'low' })
thread = await start('runner setting')
await checkLevel(thread, 'low', 'a cached model still reads the runner’s current pi settings')
mkdirSync(path.join(dir, '.pi'))
writeFileSync(
	path.join(dir, '.pi', 'settings.json'),
	JSON.stringify({ defaultThinkingLevel: 'high' }),
)
thread = await start('project setting')
await checkLevel(thread, 'high', 'the runner’s project pi settings override its global settings')
writeFileSync(path.join(dir, '.pi', 'settings.json'), '{}')
settings({ defaultThinkingLevel: 'low', modelThinkingLevels: { 'echo/echo': 'high' } })
thread = await start('per-model setting')
await checkLevel(thread, 'high', 'pi’s per-model setting wins over its global default')
thread = await start('explicit suffix', { runner: 'laptop', model: 'echo/echo:low' })
await checkLevel(thread, 'low', 'an explicit model suffix wins over pi settings')
thread = await start('explicit level', {
	runner: 'laptop',
	model: 'echo/echo',
	thinkingLevel: 'low',
})
await checkLevel(thread, 'low', 'an explicit level wins over pi settings')
await api('POST', `/api/threads/${thread.id}/entries`, {
	body: 'and again',
	to: { runner: 'laptop', model: 'echo/echo' },
})
thread = await answered(thread.id, 2)
await checkLevel(thread, 'low', 'a level-free follow-up keeps the running level')
settings({ defaultProvider: 'echo', defaultModel: 'echo/echo', defaultThinkingLevel: 'low' })
thread = await start('runner default model', { runner: 'laptop' })
await checkLevel(thread, 'low', 'a runner alone uses its pi default model and thinking')
const plain = path.join(dir, '..', 'plain')
mkdirSync(plain)
writeFileSync(path.join(plain, 'settings.json'), JSON.stringify({ defaultThinkingLevel: 'high' }))
await runner('plain', { env: { PI_CODING_AGENT_DIR: plain } })
thread = await start('no reasoning', { runner: 'plain', model: 'echo/echo' })
await checkLevel(thread, 'off', 'pi clamps a non-reasoning model’s default to off')
done()
