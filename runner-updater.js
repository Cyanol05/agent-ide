/** The runner's updater, which `curl -fsSL <server>/connect-runner | sh` downloads and starts */
import { spawn, spawnSync } from 'node:child_process'
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [server, ...given] = process.argv.slice(2)
const updates = !given.includes('--no-update')
const args = given.filter((arg) => arg !== '--no-update')
const home = process.env.AGENT_IDE_HOME || path.join(os.homedir(), '.agent-ide', 'runner')
const bun = Boolean(process.versions.bun)
if (!server) throw new Error('usage: runner-updater.js <server> [runner options]')
if (!bun && Number(process.versions.node.split('.')[0]) < 24)
	throw new Error("agent-ide's runner needs Node.js 24 or newer")

const read = (file) =>
	existsSync(path.join(home, file)) ? readFileSync(path.join(home, file), 'utf8') : ''
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The server's runner, installed here; true when that changed anything */
async function install() {
	const bundle = await (await fetch(`${server}/runner/bundle`)).json()
	if (bundle.version === read('version')) return false
	mkdirSync(path.dirname(home), { recursive: true })
	const staged = mkdtempSync(`${home}.new-`)
	const backup = `${staged}.old`
	try {
		for (const [file, text] of Object.entries(bundle.files)) {
			mkdirSync(path.dirname(path.join(staged, file)), { recursive: true })
			writeFileSync(path.join(staged, file), text)
		}
		const manifest = JSON.stringify(
			{ name: 'agent-ide-runner', private: true, type: 'module', dependencies: bundle.dependencies },
			null,
			2,
		)
		writeFileSync(path.join(staged, 'package.json'), manifest)
		if (manifest === read('package.json') && existsSync(path.join(home, 'node_modules'))) {
			cpSync(path.join(home, 'node_modules'), path.join(staged, 'node_modules'), {
				recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
			})
		} else {
			const [command, ...rest] = bun
				? [process.execPath, 'install']
				: ['npm', 'install', '--omit=dev', '--no-audit', '--no-fund']
			if (spawnSync(command, rest, { cwd: staged, stdio: 'inherit' }).status !== 0)
				throw new Error("installing the runner's packages failed")
		}
		if (!read('version') && !existsSync(path.join(os.homedir(), '.pi', 'agent', 'auth.json'))) {
			console.log(
				`No pi logins here yet, so only echo/echo answers. Log in once with ${path.join(home, 'node_modules', '.bin', 'pi')}, then /login.`,
			)
		}
		writeFileSync(path.join(staged, 'version'), bundle.version)
		const hadHome = existsSync(home)
		if (hadHome) renameSync(home, backup)
		try {
			renameSync(staged, home)
		} catch (error) {
			if (hadHome) renameSync(backup, home)
			throw error
		}
		rmSync(backup, { recursive: true, force: true })
		return true
	} finally {
		rmSync(staged, { recursive: true, force: true })
	}
}

let runner
for (const signal of ['SIGINT', 'SIGTERM'])
	process.on(signal, () => (runner ? runner.kill(signal) : process.exit(0)))

/** An update that changed nothing would only be asked for again, so after one the runner stops asking */
let stale = false
let asked = false
for (;;) {
	try {
		const changed = await install()
		stale ||= asked && !changed
	} catch (error) {
		if (!read('version')) {
			console.error(`can't fetch the runner from ${server} (${error.message}); retrying…`)
			await sleep(2000)
			continue
		}
		console.error(`can't update from ${server} (${error.message}); running the runner already here`)
		stale ||= asked
	}
	runner = spawn(process.execPath, [path.join(home, 'runner.js'), '--server', server, ...args], {
		stdio: 'inherit',
		env: { ...process.env, ...(updates && !stale ? { AGENT_IDE_LAUNCHER: '1' } : {}) },
	})
	const code = await new Promise((resolve) => runner.on('exit', (code) => {
		runner = undefined
		resolve(code)
	}))
	if (code !== 75) process.exit(code ?? 0)
	asked = true
}
