/** Stop and shutdown finish even when a connected runner ignores cancellation */
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import {
	api,
	base,
	call,
	check,
	done,
	keyFor,
	say,
	scriptedRunner,
	server,
	sleep,
	until,
	view,
} from './lib.js'

const serverProcess = await server({ MODULES: 'talk' })
const fast = await scriptedRunner('fast', (request) =>
	request.messages.some((m) => m.role === 'toolResult')
		? say('done')
		: call('post', { title: 'ask slow', body: 'hello', to: 'slow' }),
)
const key = await keyFor('slow')
const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?runner=slow&dir=/tmp`, {
	headers: { authorization: `Bearer ${key}` },
})
const model = fauxProvider({ provider: 'silent', models: [{ id: 'model' }] }).getModel()
const received = []
let resolveModels = false
socket.onmessage = ({ data }) => {
	const message = JSON.parse(data)
	received.push(message)
	if (resolveModels && message.op === 'resolve')
		socket.send(JSON.stringify({ id: message.id, result: { model } }))
	// Everything else, including cancel, goes unanswered. The socket stays open.
}
check(
	Boolean(
		await until(async () =>
			(await api('GET', '/api/runners')).json.some((r) => r.name === 'slow' && r.online),
		),
	),
	'the silent runner is connected',
)

const { id } = (await api('POST', '/api/threads', { title: 'stop a pending post' })).json
await api('POST', `/api/threads/${id}/entries`, { body: 'ask slow', to: 'echo/echo@fast' })
const resolving = await until(async () => received.find((m) => m.op === 'resolve'))
check(Boolean(resolving), 'post is resolving its destination on the silent runner')
const stopped = await Promise.race([
	api('POST', `/api/threads/${id}/stop`),
	sleep(1500).then(() => null),
])
check(stopped?.json.stopped === id, 'Stop finishes without a reply or disconnect')
check(
	Boolean(
		await until(async () => received.some((m) => m.op === 'cancel' && m.id === resolving?.id)),
	),
	'the destination receives cancellation for its resolve call',
)
if (!stopped) {
	socket.close()
	fast.close()
	done()
}
check((await view(id)).status === 'idle', 'the stopped thread is idle')
check((await view(id)).entries.length === 1, 'Stop posts no answer or error')

// A reply arriving after Stop must not revive the post or cache its resolved model.
if (resolving) socket.send(JSON.stringify({ id: resolving.id, result: { model } }))
await sleep(150)
check(
	(await api('GET', '/api/threads')).json.length === 1,
	'a late resolve creates no child thread',
)
const slow = (await api('GET', '/api/runners')).json.find((r) => r.name === 'slow')
check(
	slow.online && !slow.calls.length && !slow.models.length,
	'the runner stays online with no pending call or late model',
)

resolveModels = true
for (const [title, body, to, op] of [
	['stop a command', '$ echo hello', { runner: 'slow' }, 'env'],
	['stop a model', 'hello', { runner: 'slow', model: 'silent/model' }, 'stream'],
]) {
	const { id } = (await api('POST', '/api/threads', { title })).json
	const since = received.length
	await api('POST', `/api/threads/${id}/entries`, { body, to })
	const pending = await until(async () => received.slice(since).find((m) => m.op === op))
	check(Boolean(pending), `${title}: the runner has the call`)
	const stopped = await Promise.race([
		api('POST', `/api/threads/${id}/stop`),
		sleep(1500).then(() => null),
	])
	check(stopped?.json.stopped === id, `${title}: Stop does not wait for the runner`)
	check((await view(id)).status === 'idle', `${title}: the thread is idle`)
	check(
		Boolean(
			await until(async () => received.some((m) => m.op === 'cancel' && m.id === pending?.id)),
		),
		`${title}: cancellation crosses the wire`,
	)
}

const shutdown = (await api('POST', '/api/threads', { title: 'shutdown a pending command' })).json
	.id
const since = received.length
await api('POST', `/api/threads/${shutdown}/entries`, {
	body: '$ echo hello',
	to: { runner: 'slow' },
})
check(
	Boolean(await until(async () => received.slice(since).some((m) => m.op === 'env'))),
	'a command is pending when the server gets SIGTERM',
)
const exited = new Promise((resolve) => serverProcess.once('exit', (code) => resolve({ code })))
serverProcess.kill('SIGTERM')
const end = await Promise.race([exited, sleep(1500).then(() => null)])
check(end?.code === 0, 'shutdown exits cleanly without the runner replying or disconnecting first')
socket.close()
fast.close()
done()
