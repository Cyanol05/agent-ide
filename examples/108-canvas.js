/** An agent draws on its thread's canvas with no browser open; one watching sees it at once, it survives a restart, a fork gets its own copy, and the browser loads the server's tldraw. */
import { readFileSync } from 'node:fs'
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
const shape = (_type, shapeId, x, y, more = {}) => ({
	_type,
	shapeId,
	x,
	y,
	color: 'black',
	note: '',
	...more,
})
const drawn = [
	{
		_type: 'create',
		intent: 'the server',
		shape: shape('rectangle', 'server', 100, 100, { w: 160, h: 100, fill: 'none', text: 'Server' }),
	},
	{
		_type: 'create',
		intent: 'the runner',
		shape: shape('note', 'runner', 600, 100, { text: 'Runner' }),
	},
]
await scriptedRunner('box', (request) => {
	const latest = request.messages.at(-1)
	if (latest.role === 'user' && text(latest).includes('draw'))
		return call('canvas_act', { actions: drawn })
	if (latest.toolName === 'canvas_act')
		return call('canvas_look', { bounds: { x: 0, y: 0, w: 300, h: 300 } })
	if (latest.toolName === 'canvas_look') return say(`I see ${text(latest)}`)
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
	answer.includes('"shapeId":"server"') &&
		answer.includes('"text":"Server"') &&
		!answer.includes('Runner') &&
		answer.includes('no ade page is open in a browser'),
	'with no browser, the agent draws and looks at only the shapes within its bounds, told the sizes are guessed',
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
		server_.by === 'echo@box' &&
		shapes.some((shape) => shape.type === 'note' && shape.text === 'Runner'),
	'the API reads the same shapes, simply',
	JSON.stringify(shapes),
)

const taken = await api('POST', path, {
	actions: [
		{
			_type: 'create',
			intent: 'again',
			shape: shape('ellipse', 'server', 0, 0, { w: 50, h: 50, fill: 'none' }),
		},
	],
})
check(
	taken.json.renamed?.server === 'server-1' && taken.json.shapes[0].shapeId === 'server-1',
	'an id that is taken gets a new one, as the starter kit gives it',
	JSON.stringify(taken.json),
)
await api('POST', path, { actions: [{ _type: 'delete', intent: 'tidy', shapeId: 'server-1' }] })

await kill(srv, 'SIGKILL')
srv = await server({ MODULES: '+canvas,-auto-title,-director' })
check((await read(id)).length === 2, 'a restart keeps the canvas, even a hard one')

const fork = (await api('POST', `/api/threads/${id}/fork`, { at: answers(thread)[0].id })).json.id
check((await read(fork)).length === 2, 'a fork starts with the canvas as it was')
await api('POST', `/api/threads/${fork}/canvas`, {
	actions: [
		{
			_type: 'create',
			intent: 'fork only',
			shape: shape('text', 'mine', 100, 300, {
				anchor: 'top-left',
				maxWidth: null,
				text: 'only in the fork',
			}),
		},
	],
})
check((await read(fork)).length === 3 && (await read(id)).length === 2, 'and draws on its own copy')

// The browser loads tldraw at the server's own version, or the room and the editor speak past each other
const installed = (await api('GET', path)).json.tldraw
const page = (file) => readFileSync(new URL(`../apps/client/${file}`, import.meta.url), 'utf8')
check(
	page('canvas/tldraw.js').includes(`tldraw@${installed}?`) &&
		page('canvas.js').includes(`const TLDRAW = '${installed}'`),
	"the browser's tldraw is the server's",
	installed,
)

done()
