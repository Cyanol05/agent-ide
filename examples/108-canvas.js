/** An agent draws on its thread's canvas with no browser open; one watching sees it at once, it survives a restart, and a fork gets its own copy. */
import { getTlsyncProtocolVersion } from '@tldraw/sync-core'
import { createTLSchema } from '@tldraw/tlschema'
import {
	answered,
	answers,
	api,
	base,
	call,
	check,
	done,
	kill,
	say,
	scriptedRunner,
	server,
	text,
	until,
} from './lib.js'

let srv = await server({ MODULES: '+canvas,-auto-title,-director' })
const drawn = [
	{ type: 'rectangle', x: 100, y: 100, text: 'Server', id: 'server' },
	{ type: 'note', x: 600, y: 100, text: 'Runner' },
]
await scriptedRunner('box', (request) => {
	const latest = request.messages.at(-1)
	if (latest.role === 'user' && text(latest).includes('draw'))
		return call('canvas_create', { shapes: drawn })
	if (latest.toolName === 'canvas_create')
		return call('canvas_read', { bounds: { x: 0, y: 0, w: 300, h: 300 } })
	if (latest.toolName === 'canvas_read') return say(`I see ${text(latest)}`)
	return say('Nothing to draw')
})

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Drawing' })
const path = `/api/threads/${id}/canvas`
const empty = (await api('GET', path)).json
check(
	empty.shapes.length === 0 && /^\d+\.\d+\.\d+/.test(empty.tldraw),
	'a new canvas is empty and says its tldraw version',
	JSON.stringify(empty),
)

// Watching as a browser's tldraw does: the room's socket, its connect message, then whatever it sends
const heard = []
const socket = new WebSocket(`${base.replace(/^http/, 'ws')}${path}?sessionId=watcher`)
socket.onmessage = (event) => heard.push(String(event.data))
await new Promise((resolve) => (socket.onopen = resolve))
socket.send(
	JSON.stringify({
		type: 'connect',
		connectRequestId: 'one',
		schema: createTLSchema().serialize(),
		protocolVersion: getTlsyncProtocolVersion(),
		lastServerClock: 0,
	}),
)
check(
	await until(async () => heard.some((frame) => frame.includes('"connect"'))),
	'the room takes a browser',
)

await api('POST', `/api/threads/${id}/entries`, { body: 'draw it', to: ['echo/echo@box'] })
const thread = await answered(id)
const answer = answers(thread)[0].data.body
check(
	answer.includes('"id":"server"') &&
		answer.includes('"text":"Server"') &&
		!answer.includes('Runner'),
	'the agent draws, then reads back only the shapes within its bounds',
	answer,
)
check(
	await until(async () => heard.some((frame) => frame.includes('shape:server'))),
	'a browser watching sees the shapes as they are drawn',
)
socket.close()

const read = async (thread) => (await api('GET', `/api/threads/${thread}/canvas`)).json.shapes
const shapes = await read(id)
const server_ = shapes.find((shape) => shape.id === 'server')
check(
	shapes.length === 2 &&
		server_?.type === 'rectangle' &&
		server_.w === 160 &&
		shapes.some((shape) => shape.type === 'note' && shape.text === 'Runner'),
	'the API reads the same shapes, simply',
	JSON.stringify(shapes),
)

const taken = await api('POST', path, { shapes: [{ type: 'ellipse', x: 0, y: 0, id: 'server' }] })
check(
	taken.status >= 400 && /already/.test(taken.json.error),
	'an id that is taken is refused',
	JSON.stringify(taken.json),
)

await kill(srv, 'SIGKILL')
srv = await server({ MODULES: '+canvas,-auto-title,-director' })
check((await read(id)).length === 2, 'a restart keeps the canvas, even a hard one')

const fork = (await api('POST', `/api/threads/${id}/fork`, { at: answers(thread)[0].id })).json.id
check((await read(fork)).length === 2, 'a fork starts with the canvas as it was')
await api('POST', `/api/threads/${fork}/canvas`, {
	shapes: [{ type: 'text', x: 100, y: 300, text: 'only in the fork' }],
})
check((await read(fork)).length === 3 && (await read(id)).length === 2, 'and draws on its own copy')

done()
