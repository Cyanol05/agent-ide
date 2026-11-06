/** The runner reports status only to a terminal that answers the OSC 7501 query before device attributes (DA), which every terminal answers */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { base, check, dir, done, home, keyFor, repo, server } from './lib.js'

async function terminal(answers7501) {
	let out = ''
	let answered = false
	/** A home of its own, as every example's runner has: no pi extensions to load first */
	const env = { ...process.env, HOME: home, AGENT_IDE_KEY: await keyFor('terminal') }
	delete env.STATUS
	/** A terminal double over pipes: Node has no built-in PTY allocator. Only the query/reply matters here. */
	const p = spawn(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			`
		process.stdin.isTTY = process.stdout.isTTY = true
		process.stdin.setRawMode = () => process.stdin
		await import('./runner.js')
	`,
			'--',
			'--server',
			base,
			'--name',
			'terminal',
			'--dir',
			dir,
		],
		{
			cwd: repo,
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	)
	const closed = once(p, 'close')
	p.stderr.on('data', (bytes) => {
		out += bytes
	})
	p.stdout.setEncoding('utf8').on('data', (bytes) => {
		out += bytes
		if (!answered && out.includes('\x1b[c')) {
			answered = true
			p.stdin.write((answers7501 ? '\x1b]7501;?\x1b\\' : '') + '\x1b[?62;22c')
		}
	})
	/** Until it has been asked and, if it answers the query, has reported; then a moment for anything more to arrive */
	for (let waited = 0; waited < 8000 && !(answered && (!answers7501 || out.includes('state=idle'))); waited += 50)
		await sleep(50)
	await sleep(500)
	p.kill('SIGKILL')
	await closed
	return out
}

await server()
const yes = await terminal(true)
const no = await terminal(false)
check(
	yes.includes('state=idle'),
	'a terminal that answers the query gets reports',
	JSON.stringify(yes.slice(-200)),
)
check(
	no.includes('\x1b[c') && !no.includes(']7501;state'),
	'a terminal that only answers DA gets none',
	JSON.stringify(no.slice(-200)),
)

done()
