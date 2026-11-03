/** A failed admission's returned messages are claimed before slow preparation, once across restart. */
import { existsSync, writeFileSync } from 'node:fs'
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
	text,
	until,
	view,
} from './lib.js'

const module = path.join(dir, 'claim.js')
const preparing = path.join(dir, 'preparing')
const release = path.join(dir, 'release')
writeFileSync(
	module,
	`import { existsSync, writeFileSync } from 'node:fs'
export const server = () => ({ catchUp: async (_thread, held) => {
	if (held.length === 1 && held[0].data.body === 'first') {
		await new Promise(r => setTimeout(r, 200))
		throw new Error('injected admission failure')
	}
	if (held.some(e => e.data.body === 'second')) {
		writeFileSync(${JSON.stringify(preparing)}, '')
		while (!existsSync(${JSON.stringify(release)})) await new Promise(r => setTimeout(r, 20))
	}
	return held.map(e => e.data.body).join(' | ')
} })`,
)
const env = { MODULES: module }
let srv = await server(env)
await scriptedRunner('bot', () => say('ok'))
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'one claim' })
for (const body of ['first', 'second'])
	await api('POST', `/api/threads/${id}/entries`, { body, to: 'echo/echo@bot' })
check(
	Boolean(await until(async () => existsSync(preparing))),
	'the returned message is being prepared with the second',
)
await api('POST', `/api/threads/${id}/entries`, { body: 'third', to: 'echo/echo@bot' })
const exited = new Promise((resolve) => srv.once('exit', resolve))
srv.kill('SIGKILL')
await exited
srv = await server(env)
writeFileSync(release, '')
check(Boolean(await answered(id, 2)), 'both deliveries finish after restarting during preparation')
const c = await conversationOf(await view(id), 'echo/echo@bot')
const inputs = c.entries.filter((e) => e.kind === 'agent-ide.delivery').map((e) => text(e.model[0]))
check(
	JSON.stringify(inputs) === JSON.stringify(['first | second', 'third']),
	'the returned message reaches the agent once, never in the third delivery',
	JSON.stringify(inputs),
)
done()
