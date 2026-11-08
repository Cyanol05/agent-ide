/** A runner whose stdout is a terminal writes Program Status Protocol (OSC 7501) reports to it, byte for byte as the spec has them, without asking first */
import { spawn } from 'node:child_process'
import { api, base, check, dir, done, home, keyFor, repo, server, until, view } from './lib.js'

const srv = await server()

/** A terminal double over pipes: Node has no built-in PTY allocator. It answers nothing, so no query can pass. */
const env = { ...process.env, HOME: home, AGENT_IDE_KEY: await keyFor('laptop') }
const terminal = spawn(
	process.execPath,
	[
		'--input-type=module',
		'--eval',
		`process.stdin.isTTY = process.stdout.isTTY = true
		process.stdin.setRawMode = () => process.stdin
		await import('./runner.js')`,
		'--',
		...['--server', base, '--name', 'laptop', '--dir', dir, '--owner', 'oskar'],
	],
	{ cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] },
)
process.on('exit', () => terminal.kill('SIGKILL'))
let out = ''
terminal.stdout.setEncoding('utf8').on('data', (bytes) => {
	out += bytes
})
const shows = (sequence) => until(async () => out.includes(sequence), 8000, 50)
const encode = (text) => Buffer.from(text).toString('base64')
const report = (pairs) => `\x1b]7501;${pairs}\x1b\\`

check(
	Boolean(await shows(report(`state=idle:app=agent-ide:msg=${encode('laptop: online')}`))),
	'online: the root record is idle, names the app and the runner',
	JSON.stringify(out),
)
check(!out.includes('\x1b]7501;?'), 'no feature query: the spec lets a program report without one')

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Status test' })
await api('POST', `/api/threads/${id}/entries`, {
	body: 'hi',
	to: { runner: 'laptop', model: 'echo/echo' },
})
const title = `title=${encode(`#${id} Status test`)}`
const agents = `msg=${encode('echo:off@laptop')}`
check(
	Boolean(await shows(report(`state=done:id=${id}:${title}:${agents}`))),
	'answered and unread: done, titled with the thread, its agents as the message',
	JSON.stringify(out.slice(-400)),
)

await api('POST', `/api/threads/${id}/entries`, { body: '$ sleep 0.5' })
check(
	Boolean(await shows(report(`state=working:id=${id}:${title}:${agents}`))),
	'a command running: the thread is working',
	JSON.stringify(out.slice(-400)),
)
check(
	Boolean(await shows(report(`state=working:app=agent-ide:msg=${encode('laptop: 1 working')}`))),
	'and so is the root',
)

await until(async () => (await view(id)).status === 'done', 8000, 50)
await api('POST', `/api/threads/${id}/read`, {}, 'oskar')
check(
	Boolean(await shows(report(`state=clear:id=${id}`))),
	'read: its record is cleared',
	JSON.stringify(out.slice(-400)),
)

const {
	json: { id: broken },
} = await api('POST', '/api/threads', { title: 'Broken' })
await api('POST', `/api/threads/${broken}/entries`, {
	body: 'hi',
	to: { runner: 'laptop', model: 'openai/nope' },
})
check(
	Boolean(
		await shows(`\x1b]7501;state=error:id=${broken}:title=${encode(`#${broken} Broken`)}:msg=`),
	),
	'a failed answer: error',
	JSON.stringify(out.slice(-400)),
)

srv.kill()
check(
	Boolean(
		await shows(
			report(`state=clear:id=${broken}`) +
				report(`state=error:app=agent-ide:msg=${encode(`laptop: offline, retrying ${base}`)}`),
		),
	),
	'server gone: thread records cleared, the root is an error, not idle',
	JSON.stringify(out.slice(-400)),
)

done()
