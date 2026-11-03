/** Matrix users and HTTP users enter through the same runner-owner check. */
import { once } from 'node:events'
import { createServer } from 'node:http'
import { api, check, done, say, scriptedRunner, server, sleep, until } from './lib.js'

const events = [],
	sends = []
let synced = -1
const hs = createServer(async (req, res) => {
	const send = (body, status = 200) => {
		res.writeHead(status, { 'content-type': 'application/json' })
		res.end(JSON.stringify(body))
	}
	const url = new URL(req.url, 'http://localhost'),
		p = url.pathname
	if (p.endsWith('/account/whoami')) return send({ user_id: '@bot:fake' })
	if (p.includes('/join/')) return send({ room_id: '!room:fake' })
	if (p.endsWith('/sync')) {
		const since = url.searchParams.get('since')
		if (since !== null) {
			synced = Number(since)
			await sleep(50)
		}
		return send({
			next_batch: String(events.length),
			rooms: {
				join: {
					'!room:fake': {
						timeline: { events: since === null ? [] : events.slice(Number(since)) },
					},
				},
			},
		})
	}
	if (p.includes('/send/')) {
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		sends.push(JSON.parse(Buffer.concat(chunks).toString()))
		return send({ event_id: '$answer' })
	}
	return send({}, 404)
})
hs.listen(0, '127.0.0.1')
await once(hs, 'listening')
await server({
	MODULES: 'matrix',
	MATRIX_HOMESERVER: `http://127.0.0.1:${hs.address().port}`,
	MATRIX_TOKEN: 'test',
	MATRIX_ROOMS: '!room:fake',
	MATRIX_USERS: '@eve:fake,@alice:fake',
	MATRIX_AGENT: 'echo/echo@private',
})
await until(async () => synced === 0)
await scriptedRunner('private', () => say('private runner answered'), {
	query: [
		['owner', 'alice'],
		['allow', '@alice:fake'],
	],
})
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'direct' })
const direct = await api(
	'POST',
	`/api/threads/${id}/entries`,
	{ body: 'hello', to: 'echo/echo@private' },
	'@eve:fake',
)
check(direct.status === 403, 'HTTP refuses someone the runner did not allow')
const post = (sender) =>
	events.push({
		event_id: '$' + events.length,
		sender,
		type: 'm.room.message',
		content: { msgtype: 'm.text', body: '@bot hello' },
	})
post('@eve:fake')
check(
	Boolean(await until(async () => synced >= 1)),
	'a refused Matrix message does not block later messages',
)
check(
	(await api('GET', '/api/threads')).json.every((t) => t.agents.length === 0) && sends.length === 0,
	'Matrix refuses the same person without creating agents or starting model work',
)
post('@alice:fake')
check(
	Boolean(await until(async () => sends.length === 1)),
	'an allowed Matrix person gets an answer',
)
hs.closeAllConnections()
hs.close()
done()
