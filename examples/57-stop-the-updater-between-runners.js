/** SIGTERM stops the updater during a later fetch, or reaches the runner while it is alive. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { check, dir, done, repo, until } from './lib.js'

const home = `${dir}/installed`
await mkdir(home)
await writeFile(`${home}/version`, 'v1')
const procs = []
process.on('exit', () => {
	for (const child of procs) child.kill('SIGKILL')
})
let requests = 0,
	fetching = false
const server = createServer((req, res) => {
	if (++requests === 2)
		fetching = true // Hold the second bundle request open.
	else res.end(JSON.stringify({ version: 'v1' }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const start = () => {
	const child = spawn(
		process.execPath,
		[`${repo}/runner-updater.js`, `http://127.0.0.1:${server.address().port}`],
		{
			env: { ...process.env, AGENT_IDE_HOME: home },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	)
	child.output = ''
	child.stdout.on('data', (d) => {
		child.output += d
	})
	child.stderr.on('data', (d) => {
		child.output += d
	})
	procs.push(child)
	return child
}
try {
	await writeFile(`${home}/runner.js`, 'process.exit(75)\n')
	const updating = start()
	check(await until(async () => fetching), 'runner exits for an update and the next fetch waits')
	updating.kill('SIGTERM')
	check(
		await until(async () => updating.exitCode === 0),
		'SIGTERM stops the updater without a live runner',
	)

	await writeFile(
		`${home}/runner.js`,
		`
process.on('SIGTERM', () => { console.log('runner stopped'); process.exit(0) })
console.log('runner ready')
setInterval(() => {}, 1000)
`,
	)
	const running = start()
	check(
		await until(async () => running.output.includes('runner ready')),
		'the next runner is alive',
	)
	running.kill('SIGTERM')
	check(
		(await until(async () => running.exitCode === 0)) && running.output.includes('runner stopped'),
		'SIGTERM is forwarded to a live runner',
	)
} finally {
	server.closeAllConnections()
	server.close()
}
done()
