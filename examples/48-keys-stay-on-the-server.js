/** Only the server's machine enrolls runners; a copied runner command really connects. People remain trusted peers. */
import { execFile, spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'
import { api, base, check, dir, done, home, server, until } from './lib.js'

await server({ HOST: '0.0.0.0' })
const interfaces = networkInterfaces()
const address = [...(interfaces.tailscale0 ?? []), ...Object.values(interfaces).flat()].find(
	(a) => a.family === 'IPv4' && !a.internal,
)?.address
if (!address) throw new Error('This example needs a non-loopback network interface')
const network = base.replace('127.0.0.1', address)
const request = (url, method, route, body, headers = {}) =>
	fetch(url + route, {
		method,
		headers: { 'content-type': 'application/json', ...headers },
		body: body && JSON.stringify(body),
	})
const foreign = await request(
	base,
	'POST',
	'/api/threads',
	{ title: 'foreign' },
	{ origin: 'https://evil.example', 'content-type': 'text/plain' },
)
check(
	foreign.status === 403,
	'another website cannot write to unsecured loopback, even without a preflight',
)
check(
	(await request(base, 'OPTIONS', '/api/threads', null, { origin: 'https://evil.example' }))
		.status === 403,
	'foreign preflights are refused',
)
check(
	(await request(base, 'POST', '/api/threads', { title: 'own page' }, { origin: base })).status ===
		201,
	'the server’s own page can write',
)
check(
	!(await request(base, 'GET', '/api/threads')).headers.has('access-control-allow-origin'),
	'reads do not grant foreign websites CORS access',
)

const minted = await request(base, 'POST', '/api/runners', { name: 'pasted' }, { origin: base })
const { key, connect } = await minted.json()
check(
	minted.status === 201 && connect.includes(`AGENT_IDE_KEY=${key}`),
	'the local page mints a private runner command with a runner key',
)
check(
	connect.includes(`${network}/connect-runner`),
	'the line has a network address and the actual server port, not localhost or a placeholder',
)
check(
	(
		await request(
			network,
			'POST',
			'/api/runners',
			{ name: 'pasted' },
			{ 'x-forwarded-for': '127.0.0.1', 'x-user': 'owner' },
		)
	).status === 403,
	'a network caller cannot replace a runner key or fake being local',
)
check(
	(await request(network, 'DELETE', '/api/runners/pasted')).status === 403,
	'a network caller cannot revoke a runner key',
)
check(
	(
		await request(
			base,
			'POST',
			'/api/runners',
			{ name: 'rebound' },
			{ host: 'evil.example', origin: 'http://evil.example' },
		)
	).status === 403,
	'a rebound hostname cannot mint keys through loopback',
)

// Paste the page's exact line from the folder being lent.
const p = spawn('sh', ['-c', connect], {
	cwd: dir,
	detached: true,
	stdio: ['ignore', 'pipe', 'pipe'],
	env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '', AGENT_IDE_KEY: '' },
})
process.on('exit', () => {
	try {
		process.kill(-p.pid)
	} catch {}
})
let stdout = '',
	stderr = ''
p.stdout.on('data', (d) => (stdout += d))
p.stderr.on('data', (d) => (stderr += d))
check(
	await until(
		async () =>
			stdout.includes(`pasted online at ${network}`) &&
			(await api('GET', '/api/runners')).json.some((r) => r.name === 'pasted' && r.online),
		60000,
	),
	'the pasted line installs a runner and online means accepted',
	stdout + stderr,
)

let rejected
try {
	await promisify(execFile)(
		process.execPath,
		['runner.js', '--server', base, '--name', 'pasted', '--dir', dir, '--key', 'air_wrong'],
		{ env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '' } },
	)
} catch (error) {
	rejected = error
}
check(
	rejected?.code === 1 && !rejected.stdout.includes('pasted online at '),
	'a refused runner never says online',
)
check(
	(await api('GET', '/api/runners')).json.some((r) => r.name === 'pasted' && r.online),
	'the real runner’s key still works',
)

const cli = (...args) =>
	promisify(execFile)(process.execPath, ['cli.js', '--server', base, ...args])
check(
	(await cli('key', 'cli-runner')).stdout.includes(`${network}/connect-runner`),
	'the local CLI can mint runner keys at the actual port too',
)
const posted = await request(network, 'POST', '/api/threads', { title: 'trusted network' })
const { id } = await posted.json()
await request(
	network,
	'POST',
	`/api/threads/${id}/entries`,
	{ body: 'hello', to: null },
	{ 'x-user': 'Anyone' },
)
check(
	(await api('GET', `/api/threads/${id}`)).json.entries[0].data.author === 'Anyone',
	'people still need no keys and can claim any name: use a trusted network',
)
await cli('revoke', 'pasted')
check(
	await until(
		async () => !(await api('GET', '/api/runners')).json.find((r) => r.name === 'pasted')?.online,
	),
	'the local CLI can revoke a runner',
)
done()
