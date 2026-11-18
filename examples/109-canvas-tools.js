/** Agents change and delete what's on the canvas, bound arrows follow the shapes they join, and each shape says who drew or changed it last. */
import { getTlsyncProtocolVersion } from '@tldraw/sync-core'
import { createTLSchema, toRichText } from '@tldraw/tlschema'
import {
	answers,
	answered,
	api,
	base,
	call,
	check,
	done,
	say,
	scriptedRunner,
	server,
	text,
	until,
} from './lib.js'

await server({ MODULES: '+canvas,-auto-title,-director' })
// The bot answers "<tool> <json>" by calling the tool, then says what it answered
await scriptedRunner('box', (request) => {
	const latest = request.messages.at(-1)
	if (latest.role === 'toolResult') return say(text(latest))
	const [, tool, args] = text(latest).match(/(canvas_\w+) (\{.*\})/s) ?? []
	return tool ? call(tool, JSON.parse(args)) : say('Nothing to do')
})
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Canvas tools' })
let asked = 0
const ask = async (tool, args) => {
	await api('POST', `/api/threads/${id}/entries`, {
		body: `${tool} ${JSON.stringify(args)}`,
		to: ['echo/echo@box'],
	})
	return answers(await answered(id, ++asked)).at(-1).data.body
}
const shapes = async () =>
	Object.fromEntries(
		(await api('GET', `/api/threads/${id}/canvas`)).json.shapes.map((shape) => [shape.id, shape]),
	)

const drew = await ask('canvas_create', {
	shapes: [
		{ type: 'rectangle', x: 0, y: 0, w: 100, h: 100, id: 'a', text: 'A' },
		{ type: 'circle', x: 400, y: 0, w: 100, h: 100, id: 'b' },
		{ type: 'arrow', from: 'a', to: 'b', id: 'ab', text: 'calls' },
	],
})
let all = await shapes()
check(all.b?.type === 'ellipse', 'a circle is drawn as an ellipse', drew)
check(
	all.ab?.from === 'a' &&
		all.ab.to === 'b' &&
		all.ab.x1 === 50 &&
		all.ab.x2 === 450 &&
		all.ab.text === 'calls',
	'an arrow joins two shapes, middle to middle, even ones drawn in the same call',
	JSON.stringify(all.ab),
)
check(
	all.a.by === 'echo@box',
	'a shape says which agent drew it, by the name the thread knows it by',
	JSON.stringify(all.a),
)

await ask('canvas_update', { shapes: [{ id: 'b', x: 400, y: 300, text: 'B', color: 'red' }] })
all = await shapes()
check(
	all.b.y === 300 && all.b.text === 'B' && all.b.color === 'red' && all.b.w === 100,
	'an update moves, relabels and recolours, keeping the rest',
	JSON.stringify(all.b),
)
check(
	all.ab.y2 === 350 && all.ab.to === 'b',
	'the arrow follows the shape it points at',
	JSON.stringify(all.ab),
)
await ask('canvas_update', { shapes: [{ id: 'a', w: 200 }] })
check((await shapes()).a.w === 200, 'and resizes')

const wrong = await ask('canvas_update', { shapes: [{ id: 'nope', x: 1 }] })
check(/No shape nope/.test(wrong), 'a shape that is not there is said so', wrong)

// A person in the browser: the room's socket, as tldraw's client speaks it
const socket = new WebSocket(
	`${base.replace(/^http/, 'ws')}/api/threads/${id}/canvas?sessionId=ana-tab&user=ana`,
)
const heard = []
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
await until(async () => heard.some((frame) => frame.includes('"connect"')))
const note = {
	id: 'shape:ana',
	typeName: 'shape',
	type: 'note',
	x: 0,
	y: 500,
	rotation: 0,
	index: 'a9',
	parentId: 'page:page',
	isLocked: false,
	opacity: 1,
	meta: {},
	props: {
		color: 'yellow',
		labelColor: 'black',
		size: 'm',
		font: 'draw',
		fontSizeAdjustment: 1,
		align: 'middle',
		verticalAlign: 'middle',
		growY: 0,
		url: '',
		richText: toRichText('hers'),
		scale: 1,
		textLastEditedBy: null,
	},
}
socket.send(JSON.stringify({ type: 'push', clientClock: 1, diff: { 'shape:ana': ['put', note] } }))
check(
	await until(async () => (await shapes()).ana?.by === 'ana'),
	'a shape a person draws is theirs',
	JSON.stringify((await shapes()).ana),
)
socket.send(
	JSON.stringify({
		type: 'push',
		clientClock: 2,
		diff: { 'shape:a': ['patch', { y: ['put', 40] }] },
	}),
)
check(
	await until(async () => {
		const a = (await shapes()).a
		return a.y === 40 && a.by === 'ana'
	}),
	"moving an agent's shape makes it the person's",
	JSON.stringify((await shapes()).a),
)
socket.close()

const gone = await ask('canvas_delete', { ids: ['b'] })
all = await shapes()
check(!all.b && /Deleted b/.test(gone), 'a delete removes the shape', gone)
check(
	all.ab && !all.ab.to && all.ab.from === 'a',
	'an arrow pointing at it stays, loose at that end',
	JSON.stringify(all.ab),
)

const drawn = await api('POST', `/api/threads/${id}/canvas`, {
	shapes: [{ type: 'rectangle', x: 0, y: 800 }],
})
check(drawn.json.shapes[0].by === 'oskar', 'through the API, the person is whoever asks')

done()
