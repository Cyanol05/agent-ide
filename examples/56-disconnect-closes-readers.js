/** A runner that loses its server closes every reader it opened for it, so no file stays held */
import { once } from 'node:events'
import { readdir, readlink, writeFile } from 'node:fs/promises'
import { WebSocketServer } from 'ws'
import { check, dir, done, home, kill, start, until } from './lib.js'

await writeFile(`${dir}/text`, 'text\n')
await writeFile(`${dir}/binary`, 'bytes')

/** The server end, played here, so this socket can open readers on a real runner and then hang up */
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
await once(wss, 'listening')
const runner = start(
	'runner.js',
	['--server', `http://127.0.0.1:${wss.address().port}`, '--name', 'laptop', '--dir', dir],
	{ HOME: home, AGENT_IDE_KEY: 'any' },
)
const [socket] = await once(wss, 'connection')
const replies = new Map()
socket.on('message', (data) => {
	const message = JSON.parse(data)
	replies.set(message.id, message)
})
let next = 0
const ask = async (message) => {
	const id = ++next
	socket.send(JSON.stringify({ id, ...message }))
	return (await until(async () => replies.get(id)))?.result
}
const opened = await Promise.all(
	[
		['openTextLineReader', 'text'],
		['openBinaryReader', 'binary'],
		['openDirReader', '.'],
	].map(([method, file]) => ask({ op: 'env', cwd: dir, method, args: [file, {}] })),
)
check(
	opened.every((r) => r?.ok && r.value.handle),
	'the runner opens text, binary and directory readers',
	JSON.stringify(opened),
)

/** What the runner process holds open in its folder, from Linux's own table */
const held = async () =>
	(
		await Promise.all(
			(await readdir(`/proc/${runner.pid}/fd`)).map((fd) =>
				readlink(`/proc/${runner.pid}/fd/${fd}`).catch(() => ''),
			),
		)
	).filter((p) => p === dir || p.startsWith(`${dir}/`))
if (process.platform === 'linux') {
	check((await held()).length === 3, 'all three readers hold a file', JSON.stringify(await held()))
	socket.terminate()
	check(
		Boolean(await until(async () => !(await held()).length)),
		'when the server goes away, the runner closes every one',
		JSON.stringify(await held()),
	)
}
await kill(runner)
wss.close()
done()
