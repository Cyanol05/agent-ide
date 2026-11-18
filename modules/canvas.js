/**
 * A tldraw canvas for each thread, drawn on by people in the browser and by agents with `canvas_read` and `canvas_create`. Off
 * by default; MODULES=+canvas turns it on.
 *
 * The server holds one tldraw sync room per thread that someone has open or an agent draws on, and keeps its snapshot in
 * the thread's Canvas doc, so an agent draws with no browser open and a fork starts with the canvas as it was. A browser
 * syncs over the socket at `/api/threads/:id/canvas`. `GET /api/threads/:id/canvas` answers `{shapes, tldraw}`: the
 * shapes as agents see them, and the tldraw version the client loads, the same as the server's, to speak the room's protocol. `POST` with
 * `{shapes}` creates them, as `canvas_create` does.
 *
 * Agents see shapes simply, as the tldraw agent starter kit does: `{id, type, x, y, w, h, text, color}`, where type is a
 * geo kind (rectangle, ellipse, diamond…), `text` or `note`, and any other tldraw shape keeps its own type name.
 *
 * The tab needs the internet the first time it opens, to load tldraw from esm.sh. On localhost or plain http tldraw runs
 * without a licence key and shows its watermark; served over https at a domain it would need a key.
 */
import { readFileSync } from 'node:fs'
import { arr, num, obj, oneOf, opt, str } from '@earendil-works/pi-schema'
import { defineDoc, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { InMemorySyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import { createTLSchema, toRichText } from '@tldraw/tlschema'
import { getIndicesAbove } from '@tldraw/utils'

export const on = false

/** The client loads this same version from esm.sh: the room and the editor must speak one protocol */
const version = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.resolve('@tldraw/sync-core')), 'utf8'),
).version
/** A person's edits are saved this long after they stop; an agent's are saved before its tool returns */
const SAVE = 500

const GEO = [
	'rectangle',
	'ellipse',
	'triangle',
	'diamond',
	'pentagon',
	'hexagon',
	'octagon',
	'star',
	'rhombus',
	'oval',
	'trapezoid',
	'cloud',
	'heart',
	'x-box',
	'check-box',
	'arrow-right',
	'arrow-left',
	'arrow-up',
	'arrow-down',
]
const COLORS = [
	'black',
	'grey',
	'light-violet',
	'violet',
	'blue',
	'light-blue',
	'yellow',
	'orange',
	'green',
	'light-green',
	'light-red',
	'red',
	'white',
]
/** A note is a fixed square, scaled */
const NOTE = 200

const schema = createTLSchema()

export function server(core) {
	/** A thread's canvas: the sync room's snapshot, or null for one nobody has drawn on */
	const Canvas = defineDoc({
		kind: 'agent-ide.canvas',
		version: 1,
		scope: 'conversation',
		history: 'latest',
		fork: 'current',
		checkpointWhen: () => true,
		initial: () => ({ snapshot: null }),
	})

	/** Thread → its open room, while someone is connected or an agent draws */
	const rooms = new Map()

	function open(threadId) {
		if (!rooms.has(threadId)) rooms.set(threadId, start(threadId))
		return rooms.get(threadId)
	}

	async function start(threadId) {
		await core.conversation(threadId)
		// A doc's value is a live view of the store: copied before it leaves the commit
		const stored = await core.commit(async (tx) =>
			JSON.parse(JSON.stringify((await tx.doc(Canvas, threadId)).snapshot)),
		)
		let timer
		const save = async () => {
			clearTimeout(timer)
			const snapshot = storage.getSnapshot()
			await core.commit(async (tx) => {
				;(await tx.doc(Canvas, threadId)).snapshot = snapshot
			})
		}
		const storage = new InMemorySyncStorage({
			...(stored && { snapshot: stored }),
			onChange: () => {
				clearTimeout(timer)
				timer = setTimeout(
					() => save().catch((error) => console.error(`canvas ${threadId}: ${error.message}`)),
					SAVE,
				)
			},
		})
		const room = new TLSocketRoom({
			schema,
			storage,
			log: { warn: () => {}, error: (...args) => console.error(`canvas ${threadId}:`, ...args) },
			onSessionRemoved: (_, { numSessionsRemaining }) => {
				if (!numSessionsRemaining) close(threadId)
			},
		})
		return { room, storage, save }
	}

	/** A room nobody is in saves and closes; the next to come opens it from its snapshot */
	async function close(threadId) {
		const open = rooms.get(threadId)
		if (!open) return
		const { room, save } = await open
		if (room.getNumActiveSessions()) return
		rooms.delete(threadId)
		await save()
		room.close()
	}

	/** Every record in the room, by id */
	const recordsOf = (storage) =>
		storage.transaction((txn) => Object.fromEntries(txn.entries())).result

	async function read(threadId, bounds) {
		const { storage } = await open(threadId)
		const records = recordsOf(storage)
		close(threadId)
		return Object.values(records)
			.filter((record) => record.typeName === 'shape')
			.map((shape) => simple(shape, records))
			.filter((shape) => !bounds || overlaps(shape, bounds))
			.sort((one, other) => one.y - other.y || one.x - other.x)
	}

	async function create(threadId, shapes) {
		const { storage, save } = await open(threadId)
		try {
			const records = recordsOf(storage)
			const page = Object.values(records)
				.filter((record) => record.typeName === 'page')
				.sort(byIndex)[0]
			if (!page) throw new Error('This canvas has no page')
			const top = Object.values(records)
				.filter((record) => record.typeName === 'shape' && record.parentId === page.id)
				.sort(byIndex)
				.at(-1)?.index
			const indices = getIndicesAbove(top, shapes.length)
			const made = shapes.map((shape, at) => record(shape, page.id, indices[at], records))
			storage.transaction((txn) => {
				for (const shape of made) txn.set(shape.id, shape)
			})
			await save()
			return made.map((shape) => simple(shape, records))
		} finally {
			close(threadId)
		}
	}

	const threadOf = async (api) => (await core.home(api.conversationId))?.thread

	const canvasRead = defineTool({
		name: 'canvas_read',
		description:
			"Read your thread's canvas: its shapes as JSON, {id, type, x, y, w, h, text, color}, top to bottom. Give `bounds` to read only the shapes in that area.",
		parameters: obj({
			bounds: opt(obj({ x: num(), y: num(), w: num(), h: num() })),
		}),
		replay: 'safe',
		execute: async ({ bounds }, api) => {
			const shapes = await read(await threadOf(api), bounds)
			return {
				output: [
					{
						type: 'text',
						text: shapes.length ? JSON.stringify(shapes) : 'The canvas is empty.',
					},
				],
			}
		},
	})

	const canvasCreate = defineTool({
		name: 'canvas_create',
		description: `Draw shapes on your thread's canvas, where people in the thread see them at once. x and y are the top-left corner, in pixels; y grows downward. A shape's text is its label. Answers with the shapes as drawn, with their ids.`,
		parameters: obj({
			shapes: arr(
				obj({
					type: oneOf([...GEO, 'text', 'note']),
					x: num(),
					y: num(),
					w: opt(num({ description: 'Width; 160 by default, a note is 200 square' })),
					h: opt(num({ description: 'Height; 100 by default' })),
					text: opt(str()),
					color: opt(oneOf(COLORS)),
					id: opt(str({ description: 'Your own id for the shape, to refer to it later' })),
				}),
			),
		}),
		replay: 'unsafe',
		execute: async ({ shapes }, api) => {
			const drawn = await create(await threadOf(api), shapes)
			return {
				output: [
					{
						type: 'text',
						text: `Drew ${drawn.length} shape${drawn.length === 1 ? '' : 's'}: ${JSON.stringify(drawn)}`,
					},
				],
			}
		},
	})

	return {
		extension: defineExtension({ name: 'agent-ide.canvas', tools: [canvasRead, canvasCreate] }),
		async serve(threadId, query, body) {
			if (threadId === undefined) throw new Error('A canvas belongs to a thread')
			if (body === undefined) return { shapes: await read(threadId), tldraw: version }
			if (!Array.isArray(body.shapes)) throw new Error('POST {shapes: [...]} draws them')
			return { shapes: await create(threadId, body.shapes) }
		},
		/** A browser's tldraw sync socket */
		async connect(threadId, socket, url) {
			const sessionId = url.searchParams.get('sessionId')
			if (!sessionId) return socket.close(4000, 'no sessionId')
			const { room } = await open(threadId)
			room.handleSocketConnect({ sessionId, socket })
		},
	}
}

const byIndex = (one, other) => (one.index < other.index ? -1 : one.index > other.index ? 1 : 0)

/** A shape as agents see it, its position on the page however deep it sits */
function simple(shape, records) {
	let { x, y } = shape
	for (let parent = records[shape.parentId]; parent?.typeName === 'shape';) {
		x += parent.x
		y += parent.y
		parent = records[parent.parentId]
	}
	const { props } = shape
	const scale = props.scale ?? 1
	const size =
		shape.type === 'geo'
			? { w: props.w, h: props.h + (props.growY ?? 0) }
			: shape.type === 'note'
				? { w: NOTE * scale, h: (NOTE + (props.growY ?? 0)) * scale }
				: props.w !== undefined && props.h !== undefined
					? { w: props.w, h: props.h }
					: {}
	const text = props.richText ? plain(props.richText) : props.text
	return {
		id: shape.id.replace(/^shape:/, ''),
		type: shape.type === 'geo' ? props.geo : shape.type,
		x: Math.round(x),
		y: Math.round(y),
		...size,
		...(text && { text }),
		...(props.color && { color: props.color }),
	}
}

/** Rich text's words, a line per paragraph */
const plain = (node) =>
	node.type === 'text'
		? node.text
		: (node.content ?? []).map(plain).join(node.type === 'doc' ? '\n' : '')

const overlaps = (shape, area) =>
	shape.x <= area.x + area.w &&
	shape.x + (shape.w ?? 0) >= area.x &&
	shape.y <= area.y + area.h &&
	shape.y + (shape.h ?? 0) >= area.y

/** A tldraw record from a simple shape; an id that's taken is an error, not an overwrite */
function record({ type, x, y, w, h, text = '', color, id }, parentId, index, records) {
	const shapeId = `shape:${id ?? crypto.randomUUID().slice(0, 8)}`
	if (records[shapeId]) throw new Error(`There is already a shape ${id}`)
	const base = {
		id: shapeId,
		typeName: 'shape',
		x,
		y,
		rotation: 0,
		index,
		parentId,
		isLocked: false,
		opacity: 1,
		meta: {},
	}
	const richText = toRichText(text)
	const props =
		type === 'text'
			? {
					color: color ?? 'black',
					size: 'm',
					font: 'draw',
					textAlign: 'start',
					w: w ?? 200,
					richText,
					scale: 1,
					autoSize: w === undefined,
				}
			: type === 'note'
				? {
						color: color ?? 'yellow',
						labelColor: 'black',
						size: 'm',
						font: 'draw',
						fontSizeAdjustment: 1,
						align: 'middle',
						verticalAlign: 'middle',
						growY: 0,
						url: '',
						richText,
						scale: w ? w / NOTE : 1,
						textLastEditedBy: null,
					}
				: {
						geo: type,
						dash: 'draw',
						url: '',
						w: w ?? 160,
						h: h ?? 100,
						growY: 0,
						scale: 1,
						flipX: false,
						flipY: false,
						labelColor: 'black',
						color: color ?? 'black',
						fill: 'none',
						size: 'm',
						font: 'draw',
						align: 'middle',
						verticalAlign: 'middle',
						richText,
					}
	const shape = { ...base, type: ['text', 'note'].includes(type) ? type : 'geo', props }
	schema.types.shape.validate(shape)
	return shape
}
