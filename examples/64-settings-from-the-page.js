/** The page's settings write agent-ide.json and restart the server in place, losing nothing; only its own machine may */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { api, base, check, dir, done, server, until, view } from './lib.js'

const file = path.join(dir, 'agent-ide.json')
const srv = await server({}, { cwd: dir })
const modules = async () => (await api('GET', '/api/server')).json.modules ?? []
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'kept' })
await api('POST', `/api/threads/${id}/entries`, { body: 'still here?', to: null })

const rebound = await fetch(`${base}/api/settings`, {
	method: 'POST',
	headers: { 'content-type': 'application/json', host: 'evil.example', origin: 'http://evil.example' },
	body: JSON.stringify({ modules: { search: true } }),
})
check(rebound.status === 403 && !existsSync(file), 'only the server’s own machine changes its settings')

const pid = srv.pid
const on = await api('POST', '/api/settings', {
	modules: { search: true, status: false },
	memory: { model: 'echo/echo:high@bot', compactAt: 60000 },
})
check(on.status === 201 && on.json.restarts, 'saving says the server restarts itself', JSON.stringify(on.json))
check(
	JSON.stringify(JSON.parse(readFileSync(file, 'utf8')).modules) === '["-status","+search"]',
	'agent-ide.json says what changed from the defaults',
	readFileSync(file, 'utf8'),
)
const back = await until(async () => {
	const now = await modules().catch(() => [])
	return now.includes('search') && !now.includes('status') && now
}, 15000)
check(Boolean(back) && srv.exitCode === null && srv.pid === pid, 'it comes back with them, in the same process', JSON.stringify(back))
check((await view(id)).entries.at(-1)?.data.body === 'still here?', 'and a restart loses nothing')
check(
	JSON.parse(readFileSync(file, 'utf8')).memory.model === 'echo/echo:high@bot' &&
		(await api('GET', '/api/server')).json.settings.memory.model === 'echo/echo:high@bot',
	'the memory model keeps its thinking level across the restart',
)
check(
	JSON.parse(readFileSync(file, 'utf8')).memory.compactAt === 60000,
	'memory compacts past the tokens the page set',
	readFileSync(file, 'utf8'),
)

await api('POST', '/api/settings', { modules: { search: false, status: true }, memory: { model: '' } })
const again = await until(async () => {
	const now = await modules().catch(() => [])
	return !now.includes('search') && now.includes('status') && now
}, 15000)
check(
	Boolean(again) && !('modules' in JSON.parse(readFileSync(file, 'utf8'))),
	'switching them back leaves no module changes in the file',
	readFileSync(file, 'utf8'),
)
done()
