/** A retried request gets its receipt even when its runner can no longer resolve the recipe. */
import { answered, api, check, done, say, scriptedRunner, server, until, view } from './lib.js'

let srv = await server({ MODULES: 'talk' })
const runner = await scriptedRunner('bot', () => say('answered'))
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'offline receipt' })
const input = { body: 'hello', to: 'bot', requestId: 'same-request' }
const first = await api('POST', `/api/threads/${id}/entries`, input)
await answered(id)
runner.close()
await until(
	async () => !(await api('GET', '/api/runners')).json.find((r) => r.name === 'bot').online,
)
const retry = await api('POST', `/api/threads/${id}/entries`, input)
check(
	JSON.stringify(retry) === JSON.stringify(first),
	'offline, the same request gets the first receipt',
	JSON.stringify(retry),
)
const exited = new Promise((resolve) => srv.once('exit', resolve))
srv.kill('SIGTERM')
await exited
srv = await server({ MODULES: 'talk' })
const restarted = await api('POST', `/api/threads/${id}/entries`, input)
check(
	JSON.stringify(restarted) === JSON.stringify(first),
	'after restart, the receipt still needs no runner',
	JSON.stringify(restarted),
)
check(
	(await view(id)).entries.filter((e) => e.data.body === 'hello').length === 1,
	'the retry writes nothing twice',
)
done()
