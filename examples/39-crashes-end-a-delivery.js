/** A delivery that crash after crash cut off ends instead of running forever, and the thread says so */
import { answered, api, check, done, kill, runner, server, until, view } from './lib.js'

/** Pi's limit is five crashes in a row; two show the same */
const env = { RESTART_LIMIT: '2' }
let srv = await server(env)
let laptop = await runner('laptop')
const to = { runner: 'laptop', model: 'echo/echo' }
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'crashes' })
await api('POST', `/api/threads/${id}/entries`, { body: 'hi', to })
await answered(id)
await kill(laptop)
await until(() => api('GET', '/api/runners').then((r) => r.json.every((x) => !x.online)))
await api('POST', `/api/threads/${id}/entries`, { body: 'hello', to })
for (let i = 0; i < 3; i++) {
	await kill(srv)
	check(srv.exitCode === 0, 'a stop closes the server cleanly', `exit ${srv.exitCode}`)
	srv = await server(env)
}
check(
	(await view(id)).agents[0]?.status === 'blocked',
	'more stops than the limit later, the delivery still waits for its runner',
	(await view(id)).agents[0]?.status,
)
for (let i = 0; i < 2; i++) {
	await kill(srv, 'SIGKILL')
	srv = await server(env)
}
const v = await until(async () => {
	const v = await view(id)
	return v.status === 'error' && v
})
check(
	v?.entries.at(-1)?.data.error && v.entries.at(-1).data.body.includes('restart_limit'),
	'the thread says the agent gave no answer, and why',
	JSON.stringify(v?.entries.at(-1)?.data),
)
check(
	v?.agents[0]?.status === 'idle',
	'and the agent is idle, not working forever',
	v?.agents[0]?.status,
)
laptop = await runner('laptop')
// The runner is back, so anything still due would show as working now
const back = await view(id)
check(
	back.entries.length === v?.entries.length && back.status !== 'working',
	'nothing runs again on its own',
)
await api('POST', `/api/threads/${id}/entries`, { body: 'again', to })
const after = await answered(id, 2)
const answer = after?.entries.filter((e) => e.data.answer).at(-1)
check(Boolean(answer), 'the next ask is answered', after?.status)
check(
	JSON.stringify(answer?.data.re) ===
		JSON.stringify(
			after?.entries.filter((e) => ['hello', 'again'].includes(e.data.body)).map((e) => e.id),
		),
	'and the answer takes the message that waited too',
	JSON.stringify(answer?.data),
)
done()
