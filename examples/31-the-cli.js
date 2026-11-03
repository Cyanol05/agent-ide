/** The CLI sends to any agents, in a new thread or an old one, and prints their answers as they land */
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { promisify } from 'node:util'
import { api, base, check, dir, done, repo, runner, server, until, view } from './lib.js'

const cli = async (...args) => {
	const { stdout, stderr } = await promisify(execFile)(
		process.execPath,
		['cli.js', '--server', base, '--as', 'oskar', ...args],
		{ cwd: repo, timeout: 8000 },
	)
	return stdout + stderr
}

for (const flag of ['--help', '-h']) {
	const { stdout } = await promisify(execFile)(process.execPath, ['runner.js', flag], {
		cwd: repo,
		timeout: 8000,
	})
	check(
		[
			'server', 'name', 'alias', 'dir', 'discover-dirs', 'owner', 'allow',
			'read-only', 'key', 'key-file', 'help',
		].every((option) => stdout.includes(`--${option}`)),
		`runner ${flag} prints its options without connecting`,
		stdout,
	)
}

await server()
const laptop = await runner('laptop')
await runner('desk')

const first = await cli('post', '--to', 'echo/echo@laptop', 'hello')
const id = /thread (\d+)/.exec(first)?.[1]
check(
	id && first.includes('echo/echo@laptop') && first.includes('echo@laptop heard: oskar: hello'),
	'post starts a thread and prints the answer',
	first,
)

const both = await cli(
	'post',
	'--thread',
	id,
	'--to',
	'echo/echo@laptop',
	'--to',
	'echo/echo@desk',
	'both of you',
)
check(
	both.includes('echo@laptop heard') && both.includes('echo@desk heard'),
	'two agents on two runners, one message, both answers',
	both,
)

const again = await cli('post', '--thread', id, 'and again')
check(
	/#\d+ echo\/echo@laptop\n/.test(again) && /#\d+ echo\/echo@desk\n/.test(again),
	'no --to asks whom the thread last asked',
	again,
)

const shell = await cli('post', '--thread', id, '--to', 'echo/echo@desk', '$ echo from-desk')
check(
	shell.includes('from-desk'),
	'a $ command runs on the runner named and prints its output',
	shell,
)

const threads = await cli('threads')
check(
	threads.includes(`#${id} hello`) && threads.includes('echo/echo@desk'),
	'threads lists it with its agents',
	threads,
)
const read = await cli('read', id, '--last', '1')
check(
	read.includes('from-desk') && !read.includes('hello'),
	'read --last 1 prints only the last message',
	read,
)
const runners = await cli('runners')
check(
	runners.includes('laptop online') && runners.includes('desk online'),
	'runners lists both',
	runners,
)
const named = await cli('post', '--to', 'reviewer=echo/echo@desk', 'review this')
const namedId = /thread (\d+)/.exec(named)?.[1]
check(namedId && /#\d+ reviewer\n/.test(named), '--to can give an agent a name', named)
for (const to of ['reviewer', `${namedId}/reviewer`]) {
	const reply = await cli('post', '--thread', namedId, '--to', to, 'review again')
	check(/#\d+ reviewer\n/.test(reply), `--to ${to} reaches the thread's agent`, reply)
}
const nobody = await cli('post', '--thread', namedId, '--to', 'nobody', 'just a note')
check(!nobody, '--to nobody posts without waiting for an answer', nobody)

mkdirSync(`${dir}/review`)
const options = await cli(
	'post', '--to', 'echo/echo@desk', '--thinking', 'low', '--dir', 'review', 'with options',
)
const optionsId = /thread (\d+)/.exec(options)?.[1]
const recipe = optionsId && (await view(optionsId)).agents[0]?.to
check(
	recipe?.thinkingLevel === 'low' && recipe?.dir === 'review',
	'--thinking and --dir still set a model@runner recipe',
	JSON.stringify(recipe),
)

/** A stop posts no answer, so waiting must end on the thread's status alone. */
laptop.kill()
check(
	await until(async () =>
		!(await api('GET', '/api/runners')).json.find((r) => r.name === 'laptop').online,
	),
	'laptop goes offline',
)
const stopped = (await api('POST', '/api/threads', { title: 'stop a CLI delivery' })).json.id
const pending = cli('post', '--thread', String(stopped), '--to', 'echo/echo@laptop', 'wait for stop')
	.then(
		(output) => ({ output }),
		(error) => ({ error: error.message }),
	)
check(
	await until(async () => (await view(stopped)).status === 'blocked'),
	'CLI waits for the offline runner',
)
await cli('stop', String(stopped))
const result = await pending
check(!result.error, 'stopping a delivery ends the CLI wait without an answer', JSON.stringify(result))
check((await view(stopped)).entries.length === 1, 'a stopped delivery posts no answer')
done()
