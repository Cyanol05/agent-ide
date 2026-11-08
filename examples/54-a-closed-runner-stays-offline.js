/** A runner's newest connection is the one that counts: a closed one stays offline, and a replaced one can't take its name back */
import { api, base, check, done, keyFor, server, until } from './lib.js'

await server()
const key = await keyFor('laptop')
const row = async () => (await api('GET', '/api/runners')).json.find((r) => r.name === 'laptop')
/** A socket that says it's the runner laptop, working in `dir` */
const dial = (dir) => {
	const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?runner=laptop&dir=${dir}`, {
		headers: { authorization: `Bearer ${key}` },
	})
	socket.heard = []
	socket.onmessage = ({ data }) => socket.heard.push(JSON.parse(data))
	socket.ready = until(async () => socket.heard.some((m) => m.op === 'ready'))
	socket.closed = new Promise((resolve) => (socket.onclose = resolve))
	return socket
}

// Closed the moment it opens, while the server is still registering it
const hasty = dial('/hasty')
hasty.onopen = () => hasty.close()
await hasty.closed
check(
	Boolean(await until(async () => !(await row())?.online)) &&
		!hasty.heard.some((m) => m.op === 'ready'),
	'a runner that hangs up while registering stays offline',
	JSON.stringify(await row()),
)

const old = dial('/old')
await old.ready
check((await row())?.online && (await row()).dir === '/old', 'a runner that registers is online')
const fresh = dial('/new')
await fresh.ready
await old.closed
check(
	(await row())?.online && (await row()).dir === '/new',
	'a new connection for the name replaces the old one, which the server closes',
	JSON.stringify(await row()),
)

fresh.close()
await fresh.closed
check(
	Boolean(await until(async () => !(await row())?.online)),
	'and once the newest closes, the runner is offline',
)
done()
