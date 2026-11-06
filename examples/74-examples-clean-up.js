/** An example's disposable server goes away on success, failure and a timeout. */
import { execFile } from 'node:child_process'
import { check, done, repo, until } from './lib.js'

for (const end of [
	'done()',
	'check(false, "intentional failure"); done()',
	'throw Error("intentional failure")',
	'timeout',
]) {
	const { error, output } = await new Promise((resolve) => {
		execFile(
			process.execPath,
			['--input-type=module', '-e', `
				import { server, check, done } from './examples/lib.js'
				const child = await server()
				console.log('server pid:', child.pid)
				${end === 'timeout' ? 'setInterval(() => {}, 1000)' : end}
			`],
			{ cwd: repo, timeout: end === 'timeout' ? 4000 : 10000 },
			(error, output) => resolve({ error, output }),
		)
	})
	const pid = Number(/server pid: (\d+)/.exec(output)?.[1])
	check(Boolean(pid), `${end}: the example started a server`, output)
	check(end === 'done()' ? !error : Boolean(error), `${end}: the example reports its result`)
	const gone = pid && await until(async () => {
		try {
			process.kill(pid, 0)
			return false
		} catch (error) {
			if (error.code !== 'ESRCH') throw error
			return true
		}
	}, 3000)
	check(gone, `${end}: no server remains`)
	// Clean up the old-code reproduction too; never leave a failing check's server behind.
	if (pid && !gone) process.kill(pid, 'SIGKILL')
}
done()
