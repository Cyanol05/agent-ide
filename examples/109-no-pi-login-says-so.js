/** Starting `ade` with no pi login says so in one line, with the fix, instead of a model error */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { check, db, done, home, kill, repo, until } from './lib.js'

const piHome = path.join(home, 'empty-pi')
mkdirSync(piHome, { recursive: true })
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !/(_API_KEY|_TOKEN)$/.test(key)),
)
const child = spawn(process.execPath, [path.join(repo, 'bin.js')], {
	env: { ...env, PI_CODING_AGENT_DIR: piHome, PORT: '0', HOST: '127.0.0.1', DB_PATH: db },
	detached: true,
	stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => (output += chunk))
check(await until(async () => output.includes('runner   ')), 'the runner line appears', output)
check(
	/pi isn't logged in.*npm i -g @earendil-works\/pi-coding-agent.*`\/login`/.test(output),
	'no login says what is missing and the fix',
	output,
)
check(!output.includes("default model doesn't resolve"), 'and not the model error', output)
kill(child)
done()
