/** Slow input preparation cannot overtake an earlier message, including across a restart. */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import {
	answered,
	api,
	check,
	conversationOf,
	dir,
	done,
	say,
	scriptedRunner,
	server,
	sleep,
	text,
	view,
} from './lib.js'

const module = path.join(dir, 'slow-input.js')
writeFileSync(
	module,
	`export const server = () => ({
	catchUp: async (_thread, held) => {
		if (held.some(e => e.data.body === 'first')) await new Promise(r => setTimeout(r, 1200))
		return held.map(e => e.data.author + ': ' + e.data.body).join('\\n')
	}
})`,
)
const env = { MODULES: module }
let srv = await server(env)
await scriptedRunner('bot', (request) =>
	say(text(request.messages.findLast((m) => m.role === 'user'))),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'ordered delivery' })
for (const body of ['first', 'second'])
	await api('POST', `/api/threads/${id}/entries`, { body, to: 'echo/echo@bot' })
await sleep(200)
const exited = new Promise((resolve) => srv.once('exit', resolve))
srv.kill('SIGKILL')
await exited
srv = await server(env)
check(Boolean(await answered(id, 2)), 'both accepted messages get answers after restart')
const v = await view(id)
const c = await conversationOf(v, 'echo/echo@bot')
const inputs = c.entries.filter((e) => e.kind === 'agent-ide.delivery').map((e) => text(e.model[0]))
check(
	JSON.stringify(inputs) === JSON.stringify(['oskar: first', 'oskar: second']),
	'the slow first input reaches the agent first, each exactly once',
	JSON.stringify(inputs),
)
check(v.entries.filter((e) => e.data.answer).length === 2, 'two inputs, two answers')
done()
