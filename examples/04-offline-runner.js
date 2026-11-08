/** A runner that goes away */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { answered, api, check, dir, done, runner, server, settled, until, view } from './lib.js'

await server()
// The models pi has enabled in the runner's folder are offered, and what it can't resolve is skipped
mkdirSync(path.join(dir, '.pi'))
writeFileSync(
	path.join(dir, '.pi', 'settings.json'),
	JSON.stringify({ enabledModels: ['echo/e*', 'claude-bridge/claude-opus-5-5'] }),
)
const away = await runner('away')
const offered = (await api('GET', '/api/runners')).json.find((x) => x.name === 'away')
check(
	JSON.stringify(offered?.offers) === '["echo/echo"]' && !offered.models.includes('echo/echo'),
	'a runner offers the models enabled in pi, unresolved',
	JSON.stringify(offered),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'away' })
await api('POST', `/api/threads/${id}/entries`, {
	body: 'hi',
	to: { runner: 'away', model: 'echo/echo' },
})
await answered(id)
await api('POST', `/api/threads/${id}/read`, {})
away.kill()
await until(() =>
	api('GET', '/api/runners').then((r) => r.json.some((x) => x.name === 'away' && !x.online)),
)

const unknown = await api('POST', `/api/threads/${id}/entries`, {
	body: 'anyone?',
	to: { runner: 'away', model: 'other' },
})
check(
	unknown.status === 400 && /offline/.test(unknown.json.error),
	"an offline runner can't resolve a model it hasn't run",
	JSON.stringify(unknown),
)
// An agent is written with its model's own name, so that name finds a model the runner has run, even offline
const known = await api('POST', `/api/threads/${id}/entries`, { body: 'anyone?', to: 'echo@away' })
check(
	known.status === 201 && known.json.to?.join() === 'echo:off@away',
	'an offline runner knows a model it has run by its own name, as an agent is written',
	JSON.stringify(known),
)
const blocked = await until(async () => (await view(id)).status === 'blocked')
check(Boolean(blocked), 'a thread waiting for an offline runner is blocked')

await api('POST', `/api/threads/${id}/stop`, {})
const stopped = await settled(id)
check(
	stopped?.status === 'idle' && !stopped.entries.some((e) => e.data.error),
	'a stopped thread is idle, with no error entry',
	`${stopped?.status} ${JSON.stringify(stopped?.entries)}`,
)

done()
