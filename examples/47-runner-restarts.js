/** A failed update leaves the runner usable, and each runner has its own restart command. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { api, base, check, db, dir, done, keyFor, repo, server, until } from './lib.js'

const home = path.join(path.dirname(db), 'shared home')
mkdirSync(home)
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: '', AGENT_IDE_KEY: '' }
const procs = []
process.on('exit', () => {
	for (const p of procs) try { process.kill(-p.pid) } catch {}
})
function start(command, extra = {}) {
	const p = spawn('sh', ['-c', command], { env: { ...env, ...extra }, detached: true })
	p.output = ''
	p.stdout.on('data', (d) => { p.output += d })
	p.stderr.on('data', (d) => { p.output += d })
	procs.push(p)
	return p
}
const online = async (name) => (await api('GET', '/api/runners')).json.find((r) => r.name === name)?.online
const stop = async (p) => {
	process.kill(-p.pid, 'SIGTERM')
	await new Promise((resolve) => p.on('exit', resolve))
}

await server()
const commands = []
for (const name of ['first', 'second']) {
	const key = await keyFor(name)
	const p = start(`curl -fsSL ${base}/connect-runner | sh -s -- --name ${name} --dir '${dir}'`, { AGENT_IDE_KEY: key })
	check(await until(() => online(name), 60000), `${name} connects`, p.output)
	if (p.exitCode !== null) done()
	const line = await until(async () => /Next time, without curl: (.*)/.exec(p.output)?.[1])
	commands.push(line)
	await stop(p)
	await until(async () => !(await online(name)))
}
const renewed = await keyFor('first')
const reinstall = start(`curl -fsSL ${base}/connect-runner | sh -s -- --name=first --dir '${dir}'`, { AGENT_IDE_KEY: renewed })
check(await until(() => online('first'), 30000), 'reinstalling first connects with its new key')
await stop(reinstall)
await until(async () => !(await online('first')))
const keys = path.join(home, '.config', 'agent-ide')
check(readdirSync(keys).sort().join(',') === 'key.first,key.second' && readFileSync(path.join(keys, 'key.first'), 'utf8') === renewed, 'reinstalling replaces its key without leaving extra files')
for (const [i, name] of ['first', 'second'].entries()) {
	const p = start(commands[i] || 'exit 1')
	check(await until(() => online(name), 30000), `${name} restarts with its own printed command`)
	await stop(p)
	await until(async () => !(await online(name)))
}

const hostname = os.hostname()
const unnamed = start(`curl -fsSL ${base}/connect-runner | sh -s -- --dir '${dir}'`, { AGENT_IDE_KEY: await keyFor(hostname) })
check(await until(() => online(hostname), 30000), 'an unnamed runner uses its hostname')
check(readdirSync(keys).includes(`key.${hostname}`), 'its key is saved under the hostname')
await stop(unnamed)

const old = path.join(home, 'old-runner')
mkdirSync(old)
writeFileSync(path.join(old, 'version'), 'old')
writeFileSync(path.join(old, 'runner.js'), "console.log('OLD RUNNER STARTED')\n")
const dependencies = { missing: 'file:/definitely-not-a-runner-package' }
let bundle = { version: 'new', files: { 'runner.js': "throw Error('new runner')" }, dependencies }
const fake = createServer((req, res) => res.end(JSON.stringify(bundle)))
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
const p = start(`'${process.execPath}' '${path.join(repo, 'runner-updater.js')}' http://127.0.0.1:${fake.address().port}`, { AGENT_IDE_HOME: old })
await new Promise((resolve) => p.on('exit', resolve))
check(p.output.includes('OLD RUNNER STARTED') && readFileSync(path.join(old, 'version'), 'utf8') === 'old', 'a failed dependency install starts the old runner')
mkdirSync(path.join(old, 'node_modules'))
writeFileSync(path.join(old, 'node_modules', 'kept'), 'installed')
writeFileSync(path.join(old, 'package.json'), JSON.stringify({ name: 'agent-ide-runner', private: true, type: 'module', dependencies }, null, 2))
bundle = { ...bundle, files: { 'runner.js': "import { readFileSync } from 'node:fs'; console.log(readFileSync(new URL('./node_modules/kept', import.meta.url), 'utf8'))" } }
const reused = start(`'${process.execPath}' '${path.join(repo, 'runner-updater.js')}' http://127.0.0.1:${fake.address().port}`, { AGENT_IDE_HOME: old })
await new Promise((resolve) => reused.on('exit', resolve))
check(reused.output.includes('installed') && readFileSync(path.join(old, 'version'), 'utf8') === 'new', 'unchanged dependencies are reused without installing')
fake.close()
done()
