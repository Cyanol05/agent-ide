/** CLI folder and thinking flags preserve every part of a model address. */
import { mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { api, base, check, dir, done, repo, runner, server, view } from './lib.js'

await server()
await runner('desk')
mkdirSync(`${dir}/review`)
const cli = (...args) =>
	promisify(execFile)(
		process.execPath,
		['cli.js', '--server', base, 'post', '--no-wait', ...args],
		{ cwd: repo },
	)
const thread = async () =>
	(await api('POST', '/api/threads', { title: 'CLI address options' })).json.id
const id = await thread()
await cli('--thread', String(id), '--to', 'echo/echo:low@desk', '--dir', 'review', 'keep thinking')
let asked = (await view(id)).agents[0]?.to
check(
	asked?.model === 'echo/echo' && asked?.thinkingLevel === 'low' && asked?.dir === 'review',
	'--dir preserves inline thinking',
	JSON.stringify(asked),
)
await cli(
	'--thread',
	String(id),
	'--to',
	'echo/echo:low@desk',
	'--thinking',
	'high',
	'override thinking',
)
asked = (await view(id)).agents[0]?.to
check(
	asked?.thinkingLevel === 'high',
	'--thinking overrides inline thinking',
	JSON.stringify(asked),
)
for (const name of ['ada', 'ada=echo/echo:low@desk']) {
	const result = await cli(
		'--thread',
		String(await thread()),
		'--to',
		name,
		'--dir',
		'review',
		'invalid name',
	).then(
		() => '',
		(error) => error.stderr,
	)
	check(
		name.includes('=')
			? /only bots have names/.test(result)
			: /require a model@runner/.test(result),
		`flags do not turn ${name} into a different model`,
		result,
	)
}
done()
