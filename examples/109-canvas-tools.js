/** Agents act on the canvas through the tab someone used last, or on the stored shapes when no tab answers; a bound arrow follows its shapes, and each shape says who drew or changed it last. */
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
	if (latest.role === 'toolResult')
		return say(
			`${text(latest)}${latest.content.some((part) => part.type === 'image') ? ' [and a picture]' : ''}`,
		)
	const [, tool, args] = text(latest).match(/(canvas_\w+) (\{.*\})/s) ?? []
	return tool ? call(tool, JSON.parse(args)) : say('Nothing to do')
})
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Canvas tools' })
const path = `/api/threads/${id}/canvas`
let asked = 0
const ask = async (tool, args) => {
	await api('POST', `/api/threads/${id}/entries`, {
		body: `${tool} ${JSON.stringify(args)}`,
		to: ['echo/echo@box'],
	})
	return answers(await answered(id, ++asked)).at(-1).data.body
}
const shapes = async () =>
	Object.fromEntries((await api('GET', path)).json.shapes.map((shape) => [shape.id, shape]))
const geo = (shapeId, x, y, more = {}) => ({
	_type: 'rectangle',
	shapeId,
	x,
	y,
	w: 100,
	h: 100,
	color: 'black',
	fill: 'none',
	note: '',
	...more,
})

// No tab: what needs no layout, done on the stored shapes
const drew = await ask('canvas_act', {
	actions: [
		{ _type: 'create', intent: 'a', shape: geo('a', 0, 0, { text: 'A' }) },
		{ _type: 'create', intent: 'b', shape: geo('b', 400, 0, { _type: 'ellipse' }) },
		{
			_type: 'create',
			intent: 'a calls b',
			shape: {
				_type: 'arrow',
				shapeId: 'ab',
				fromId: 'a',
				toId: 'b',
				x1: 0,
				y1: 0,
				x2: 0,
				y2: 0,
				color: 'black',
				note: '',
				text: 'calls',
			},
		},
		{ _type: 'align', intent: 'line up', alignment: 'top', gap: 0, shapeIds: ['a', 'b'] },
	],
})
let all = await shapes()
check(
	all.ab?.from === 'a' && all.ab.to === 'b' && all.ab.x1 === 50 && all.ab.x2 === 450,
	'an arrow joins two shapes, middle to middle',
	JSON.stringify(all.ab),
)
check(all.a.by === 'echo@box', 'a shape says which agent drew it', JSON.stringify(all.a))
check(
	drew.startsWith('create 3; 1 skipped') && drew.includes('needs the canvas open in a browser'),
	'what needs a laid-out editor says it needs a browser, and the rest is done',
	drew,
)

await ask('canvas_act', {
	actions: [
		{ _type: 'move', intent: 'down', shapeId: 'b', x: 450, y: 350, anchor: 'center' },
		{ _type: 'label', intent: 'name it', shapeId: 'b', text: 'B' },
		{
			_type: 'update',
			intent: 'wider',
			update: geo('a', 0, 0, { w: 200, text: 'A', color: 'red' }),
		},
	],
})
all = await shapes()
check(
	all.b.x === 400 && all.b.y === 300 && all.b.text === 'B',
	'move puts its anchor where it says, and label relabels',
	JSON.stringify(all.b),
)
check(all.a.w === 200 && all.a.color === 'red', 'update changes a shape to what it gives')
check(
	all.ab.y2 === 350 && all.ab.to === 'b',
	'the arrow follows the shape it points at',
	JSON.stringify(all.ab),
)

// A tab: the room's socket as tldraw's client speaks it, answering what the server hands it as a host would
function tab(name, user, answer) {
	const socket = new WebSocket(
		`${base.replace(/^http/, 'ws')}${path}?sessionId=${name}&tab=${name}&user=${user}`,
	)
	const heard = []
	socket.onmessage = async (event) => {
		const frame = String(event.data)
		heard.push(frame)
		const message = JSON.parse(frame)
		for (const one of Array.isArray(message) ? message : [message])
			if (one.type === 'custom' && one.data?.call) answer(one.data, socket)
	}
	const opened = new Promise((resolve) => (socket.onopen = resolve)).then(() =>
		socket.send(
			JSON.stringify({
				type: 'connect',
				connectRequestId: name,
				schema: createTLSchema().serialize(),
				protocolVersion: getTlsyncProtocolVersion(),
				lastServerClock: 0,
			}),
		),
	)
	return { socket, heard, opened, use: () => api('POST', path, { active: name }) }
}
const handed = []
/** One white pixel, as a tab's picture of the canvas */
const DOT =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
const reply = (from) => (data) => {
	handed.push({ from, ...data })
	api('POST', path, {
		answer: {
			call: data.call,
			result: data.look
				? {
						selected: [{ shapeId: 'a', type: 'rectangle', x: 0, y: 0, w: 200, h: 140 }],
						picture: { mimeType: 'image/png', data: DOT },
						shapes: [{ shapeId: 'a', type: 'rectangle', x: 0, y: 0, w: 200, h: 140 }],
						lints: [{ type: 'growY-on-shape', shapeIds: ['a'] }],
					}
				: {
						applied: data.act.actions.map(({ _type }) => ({ _type, ok: true })),
						shapes: [],
						deleted: [],
						lints: [],
					},
		},
	})
}
const one = tab('one', 'ana', reply('one'))
const two = tab('two', 'ana', reply('two'))
await Promise.all([one.opened, two.opened])
await until(async () => one.heard.length && two.heard.length)
await one.use()

const seen = await ask('canvas_look', {})
check(
	handed.at(-1)?.from === 'one' &&
		seen.includes('"h":140') &&
		seen.includes('growY-on-shape') &&
		seen.includes('"selected":[{"shapeId":"a"') &&
		seen.endsWith('[and a picture]') &&
		!seen.includes(DOT),
	'a look goes to the tab used last, and answers what its editor found, what the person selected, and a picture the model sees as one',
	seen,
)
await two.use()
const done_ = await ask('canvas_act', {
	actions: [
		{ _type: 'stack', intent: 'tidy', direction: 'vertical', gap: 20, shapeIds: ['a', 'b'] },
	],
})
check(
	handed.at(-1)?.from === 'two' &&
		handed.at(-1).act.actions[0]._type === 'stack' &&
		done_.startsWith('stack 1'),
	'so do actions, even those only an editor can do',
	done_,
)

// A tab that closes while it's asked: the server does what it can alone, and says why
two.socket.onmessage = () => two.socket.close()
const fell = await ask('canvas_act', {
	actions: [{ _type: 'label', intent: 'rename', shapeId: 'a', text: 'Alpha' }],
})
check(
	fell.includes('the browser closed the canvas') && (await shapes()).a.text === 'Alpha',
	'a tab that closes mid-call leaves it to the server, which says so',
	fell,
)
one.socket.close()

// Who drew it: a person's new shape is theirs; moving an agent's makes it theirs
const ana = tab('ana-tab', 'ana', () => {})
await ana.opened
await until(async () => ana.heard.some((frame) => frame.includes('"connect"')))
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
ana.socket.send(
	JSON.stringify({ type: 'push', clientClock: 1, diff: { 'shape:ana': ['put', note] } }),
)
check(
	await until(async () => (await shapes()).ana?.by === 'ana'),
	'a shape a person draws is theirs',
)
ana.socket.send(
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
)
ana.socket.close()

const gone = await api('POST', path, {
	actions: [{ _type: 'delete', intent: 'drop', shapeId: 'b' }],
})
all = await shapes()
check(
	!all.b && gone.json.deleted[0] === 'b',
	'a delete removes the shape',
	JSON.stringify(gone.json),
)
check(
	all.ab && !all.ab.to && all.ab.from === 'a',
	'an arrow pointing at it stays, loose at that end',
)
check(
	gone.json.estimated?.includes('sizes guessed'),
	'and with no tab left, the server says the sizes are its guess',
)

done()
