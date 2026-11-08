/** RUNNER=dir starts a runner on the server's own machine, named after it, as a process of its own that stops with the server */
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { answered, api, check, dir, done, kill, server, until, view } from './lib.js'

const name = os.hostname()
const online = async () =>
	(await api('GET', '/api/runners')).json.find((r) => r.name === name)?.online
/** No pi logins of yours: echo needs none */
const HOME = mkdtempSync(path.join(os.tmpdir(), 'agent-ide-home-'))

let srv = await server({ RUNNER: dir, HOME })
check(await until(online), `the server's machine is a runner, ${name}`)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'lent' })
await api('POST', `/api/threads/${id}/entries`, {
	body: 'hello',
	to: { runner: name, model: 'echo/echo' },
})
const v = await answered(id)
check(v?.entries.at(-1).data.body.startsWith(`echo@${name} heard`), 'an agent on it answers')

await kill(srv)
/** The server's runner shares its process group, so an empty group means it exited too */
const alone = () => {
	try {
		process.kill(-srv.pid, 0)
		return false
	} catch (error) {
		return error.code === 'ESRCH'
	}
}
check(Boolean(await until(async () => alone())), 'its runner stopped with the server')
srv = await server()
check(!(await online()), 'so it never comes back')
check((await view(id)).entries.length === v.entries.length, 'and the thread kept everything')
done()
