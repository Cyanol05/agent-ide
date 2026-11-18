/**
 * A tldraw canvas for each thread, drawn on by people in the browser and by agents with `canvas_read`, `canvas_create`,
 * `canvas_update` and `canvas_delete`. Off by default; MODULES=+canvas turns it on.
 *
 * The server holds one tldraw sync room per thread that someone has open or an agent draws on, and keeps its snapshot in
 * the thread's Canvas doc, so an agent draws with no browser open and a fork starts with the canvas as it was. A browser
 * syncs over the socket at `/api/threads/:id/canvas?user=<name>`. `GET /api/threads/:id/canvas` answers
 * `{shapes, tldraw}`: the shapes as agents see them, and the tldraw version the client loads, the same as the server's,
 * to speak the room's protocol. `POST` with `{shapes}` draws them, as `canvas_create` does; `{update}` changes them, as
 * `canvas_update` does, and `{delete: [ids]}` deletes them.
 *
 * Agents see shapes simply, as the tldraw agent starter kit does: `{id, type, x, y, w, h, text, color, by}`, where type
 * is a geo kind (rectangle, ellipse, diamond…; `circle` draws an ellipse), `text` or `note`, and any other tldraw shape
 * keeps its own type name. `by` is who drew or changed it last: the person, or the bot's name, or the agent's
 * model@runner, kept in the shape's `meta.by`. An arrow is `{id, type: "arrow", from, to, x1, y1, x2, y2}`: drawn
 * between two shapes, it is bound to both and follows them when they move.
 *
 * The tab needs the internet the first time it opens, to load tldraw from esm.sh. On localhost or plain http tldraw runs
 * without a licence key and shows its watermark; served over https at a domain it would need a key.
 */
import { readFileSync } from 'node:fs'
import { arr, num, obj, oneOf, opt, str } from '@earendil-works/pi-schema'
import { defineDoc, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { speaker } from '../util.js'
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
		kind: 'ade.canvas',
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
		/** Shapes a person changed whose `by` names someone else, until the room says so */
		const touched = new Map()
		const room = new TLSocketRoom({
			schema,
			storage,
			// A person's new shape is theirs as it lands; a change to someone else's is stamped right after
			authorizeRecord: {
				shape: ({ session, type, prev, next }) => {
					if (type === 'create') return { ...next, meta: { ...next.meta, by: session.meta.by } }
					if (type === 'update' && next.meta?.by !== session.meta.by)
						touched.set(next.id, session.meta.by)
					return next ?? prev
				},
			},
			onCommittedChanges: () => {
				if (!touched.size) return
				const stamps = [...touched]
				touched.clear()
				queueMicrotask(() =>
					storage.transaction((txn) => {
						for (const [id, by] of stamps) {
							const shape = txn.get(id)
							if (shape && shape.meta?.by !== by) txn.set(id, stamped(shape, by))
						}
					}),
				)
			},
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
			.sort(
				(one, other) =>
					(one.y ?? one.y1) - (other.y ?? other.y1) || (one.x ?? one.x1) - (other.x ?? other.x1),
			)
	}

	/**
	 * One change to a thread's canvas: `make(records)` answers the records to set and the ids to delete, and what to
	 * answer; nothing is written if it throws. Saved before it returns.
	 */
	async function change(threadId, make) {
		const { storage, save } = await open(threadId)
		try {
			const records = recordsOf(storage)
			const { set = [], remove = [], answer } = make(records)
			storage.transaction((txn) => {
				for (const id of remove) txn.delete(id)
				for (const record of set) txn.set(record.id, record)
			})
			await save()
			return answer(recordsOf(storage))
		} finally {
			close(threadId)
		}
	}

	const create = (threadId, shapes, by) =>
		change(threadId, (records) => {
			const page = Object.values(records)
				.filter((record) => record.typeName === 'page')
				.sort(byIndex)[0]
			if (!page) throw new Error('This canvas has no page')
			const top = Object.values(records)
				.filter((record) => record.typeName === 'shape' && record.parentId === page.id)
				.sort(byIndex)
				.at(-1)?.index
			const indices = getIndicesAbove(top, shapes.length)
			// Arrows last, so they can point at shapes made in the same call
			const order = shapes
				.map((shape, at) => ({ shape, index: indices[at] }))
				.sort((one, other) => (one.shape.type === 'arrow') - (other.shape.type === 'arrow'))
			const all = { ...records }
			const made = []
			for (const { shape, index } of order) {
				const drawn =
					shape.type === 'arrow'
						? arrow(shape, page.id, index, all, by)
						: [record(shape, page.id, index, all, by)]
				for (const one of drawn) all[one.id] = one
				made.push(...drawn)
			}
			return {
				set: made,
				answer: (now) =>
					made.filter((one) => one.typeName === 'shape').map((one) => simple(now[one.id], now)),
			}
		})

	const update = (threadId, shapes, by) =>
		change(threadId, (records) => {
			const changed = shapes.map((shape) => updated(shape, records, by))
			return {
				set: changed,
				answer: (now) => changed.map((one) => simple(now[one.id], now)),
			}
		})

	/** Shapes go with what's inside them and the bindings that hold them; an arrow bound to one stays, loose */
	const remove = (threadId, ids, by) =>
		change(threadId, (records) => {
			const missing = ids.filter((id) => records[`shape:${id}`]?.typeName !== 'shape')
			if (missing.length) throw new Error(`No shape ${missing.join(', ')}`)
			const gone = new Set(ids.map((id) => `shape:${id}`))
			for (let more = true; more;) {
				more = false
				for (const record of Object.values(records))
					if (record.typeName === 'shape' && gone.has(record.parentId) && !gone.has(record.id))
						more = gone.add(record.id)
			}
			const bindings = Object.values(records).filter(
				(record) =>
					record.typeName === 'binding' && (gone.has(record.fromId) || gone.has(record.toId)),
			)
			// A loose arrow keeps the ends it was drawn to and says who loosened it
			const loosened = [
				...new Set(
					bindings.filter((binding) => !gone.has(binding.fromId)).map((binding) => binding.fromId),
				),
			].map((id) => stamped(records[id], by))
			return {
				set: loosened,
				remove: [...gone, ...bindings.map((binding) => binding.id)],
				answer: () => [...gone].map((id) => id.replace(/^shape:/, '')),
			}
		})

	/** Who a tool call is: the bot's name, or the agent's model@runner, and its thread */
	const caller = async (api) => {
		const found = await core.home(api.conversationId)
		return { threadId: found?.thread, by: found?.name ?? 'an agent' }
	}
	const text = (value) => ({ output: [{ type: 'text', text: value }] })

	const canvasRead = defineTool({
		name: 'canvas_read',
		description:
			'Read your thread\'s canvas: its shapes as JSON, {id, type, x, y, w, h, text, color, by}, top to bottom, `by` naming who drew or changed it last. An arrow is {id, type: "arrow", from, to, x1, y1, x2, y2, text}: the shapes it joins, and where its ends are now. Give `bounds` to read only the shapes in that area.',
		parameters: obj({
			bounds: opt(obj({ x: num(), y: num(), w: num(), h: num() })),
		}),
		replay: 'safe',
		execute: async ({ bounds }, api) => {
			const shapes = await read((await caller(api)).threadId, bounds)
			return text(shapes.length ? JSON.stringify(shapes) : 'The canvas is empty.')
		},
	})

	const canvasCreate = defineTool({
		name: 'canvas_create',
		description: `Draw shapes on your thread's canvas, where people in the thread see them at once. x and y are the top-left corner, in pixels; y grows downward. A shape's text is its label. An arrow joins two shapes by id, \`from\` and \`to\`, and follows them when they move; it needs no x or y. Answers with the shapes as drawn, with their ids.`,
		parameters: obj({
			shapes: arr(
				obj({
					type: oneOf([...GEO, 'circle', 'text', 'note', 'arrow']),
					x: opt(num({ description: 'Left edge; every shape but an arrow has one' })),
					y: opt(num({ description: 'Top edge; every shape but an arrow has one' })),
					w: opt(num({ description: 'Width; 160 by default, a note is 200 square' })),
					h: opt(num({ description: 'Height; 100 by default' })),
					text: opt(str()),
					color: opt(oneOf(COLORS)),
					id: opt(str({ description: 'Your own id for the shape, to refer to it later' })),
					from: opt(str({ description: "An arrow's start: a shape's id" })),
					to: opt(str({ description: "An arrow's end: a shape's id" })),
				}),
			),
		}),
		replay: 'unsafe',
		execute: async ({ shapes }, api) => {
			const { threadId, by } = await caller(api)
			const drawn = await create(threadId, shapes, by)
			return text(
				`Drew ${drawn.length} shape${drawn.length === 1 ? '' : 's'}: ${JSON.stringify(drawn)}`,
			)
		},
	})

	const canvasUpdate = defineTool({
		name: 'canvas_update',
		description:
			"Change shapes on your thread's canvas by id: give only what changes. x and y move it, w and h resize it, text relabels it. Arrows bound to a shape follow it. Answers with the shapes as they are now.",
		parameters: obj({
			shapes: arr(
				obj({
					id: str(),
					x: opt(num()),
					y: opt(num()),
					w: opt(num()),
					h: opt(num()),
					text: opt(str()),
					color: opt(oneOf(COLORS)),
				}),
			),
		}),
		replay: 'safe',
		execute: async ({ shapes }, api) => {
			const { threadId, by } = await caller(api)
			const changed = await update(threadId, shapes, by)
			return text(`Changed ${changed.length}: ${JSON.stringify(changed)}`)
		},
	})

	const canvasDelete = defineTool({
		name: 'canvas_delete',
		description:
			"Delete shapes from your thread's canvas by id, with whatever is inside them. An arrow bound to one stays, loose.",
		parameters: obj({ ids: arr(str()) }),
		replay: 'safe',
		execute: async ({ ids }, api) => {
			const { threadId, by } = await caller(api)
			const gone = await remove(threadId, ids, by)
			return text(`Deleted ${gone.join(', ')}`)
		},
	})

	return {
		extension: defineExtension({
			name: 'ade.canvas',
			tools: [canvasRead, canvasCreate, canvasUpdate, canvasDelete],
		}),
		async serve(threadId, query, body, user) {
			if (threadId === undefined) throw new Error('A canvas belongs to a thread')
			if (body === undefined) return { shapes: await read(threadId), tldraw: version }
			if (Array.isArray(body.shapes)) return { shapes: await create(threadId, body.shapes, user) }
			if (Array.isArray(body.update)) return { shapes: await update(threadId, body.update, user) }
			if (Array.isArray(body.delete)) return { deleted: await remove(threadId, body.delete, user) }
			throw new Error('POST {shapes} draws, {update} changes, {delete: [ids]} deletes')
		},
		/** A browser's tldraw sync socket; `user` says who is drawing */
		async connect(threadId, socket, url) {
			const sessionId = url.searchParams.get('sessionId')
			if (!sessionId) return socket.close(4000, 'no sessionId')
			const { room } = await open(threadId)
			room.handleSocketConnect({
				sessionId,
				socket,
				meta: { by: speaker(url.searchParams.get('user')) },
			})
		},
	}
}

const byIndex = (one, other) => (one.index < other.index ? -1 : one.index > other.index ? 1 : 0)

/** A record that says who changed it last */
const stamped = (record, by) => ({ ...record, meta: { ...record.meta, by } })

/** Where a shape sits on the page, however deep it is */
function onPage(shape, records) {
	let { x, y } = shape
	for (let parent = records[shape.parentId]; parent?.typeName === 'shape';) {
		x += parent.x
		y += parent.y
		parent = records[parent.parentId]
	}
	return { x, y }
}

/** A shape's size as agents see it, when it has one */
function sizeOf(shape) {
	const { props } = shape
	const scale = props.scale ?? 1
	if (shape.type === 'geo') return { w: props.w, h: props.h + (props.growY ?? 0) }
	if (shape.type === 'note') return { w: NOTE * scale, h: (NOTE + (props.growY ?? 0)) * scale }
	if (props.w !== undefined && props.h !== undefined) return { w: props.w, h: props.h }
	return {}
}

/** The middle of a shape on the page, where a bound arrow points */
function middle(shape, records) {
	const { x, y } = onPage(shape, records)
	const { w = 0, h = 0 } = sizeOf(shape)
	return { x: x + w / 2, y: y + h / 2 }
}

/** The shapes an arrow's ends are bound to, by terminal */
const endsOf = (arrow, records) =>
	Object.fromEntries(
		Object.values(records)
			.filter((record) => record.typeName === 'binding' && record.fromId === arrow.id)
			.map((binding) => [binding.props.terminal, records[binding.toId]])
			.filter(([, shape]) => shape),
	)

const short = (id) => id.replace(/^shape:/, '')

/** A shape as agents see it, on the page; an arrow as the shapes it joins and where its ends are now */
function simple(shape, records) {
	const { props } = shape
	const text = props.richText ? plain(props.richText) : props.text
	const said = {
		...(text && { text }),
		...(props.color && { color: props.color }),
		...(shape.meta?.by && { by: shape.meta.by }),
	}
	if (shape.type === 'arrow') {
		const { x, y } = onPage(shape, records)
		const ends = endsOf(shape, records)
		const [start, end] = ['start', 'end'].map((terminal) =>
			ends[terminal]
				? middle(ends[terminal], records)
				: { x: x + props[terminal].x, y: y + props[terminal].y },
		)
		return {
			id: short(shape.id),
			type: 'arrow',
			...(ends.start && { from: short(ends.start.id) }),
			...(ends.end && { to: short(ends.end.id) }),
			x1: Math.round(start.x),
			y1: Math.round(start.y),
			x2: Math.round(end.x),
			y2: Math.round(end.y),
			...said,
		}
	}
	const { x, y } = onPage(shape, records)
	return {
		id: short(shape.id),
		type: shape.type === 'geo' ? props.geo : shape.type,
		x: Math.round(x),
		y: Math.round(y),
		...sizeOf(shape),
		...said,
	}
}

/** Rich text's words, a line per paragraph */
const plain = (node) =>
	node.type === 'text'
		? node.text
		: (node.content ?? []).map(plain).join(node.type === 'doc' ? '\n' : '')

const overlaps = (shape, area) => {
	const [x, y, w, h] =
		shape.type === 'arrow'
			? [
					Math.min(shape.x1, shape.x2),
					Math.min(shape.y1, shape.y2),
					Math.abs(shape.x2 - shape.x1),
					Math.abs(shape.y2 - shape.y1),
				]
			: [shape.x, shape.y, shape.w ?? 0, shape.h ?? 0]
	return x <= area.x + area.w && x + w >= area.x && y <= area.y + area.h && y + h >= area.y
}

/** A fresh shape id from the agent's own, or a short random one; an id that's taken is an error, not an overwrite */
function newId(id, records) {
	const shapeId = `shape:${id ?? crypto.randomUUID().slice(0, 8)}`
	if (records[shapeId]) throw new Error(`There is already a shape ${id}`)
	return shapeId
}

const base = (id, x, y, index, parentId, by) => ({
	id,
	typeName: 'shape',
	x,
	y,
	rotation: 0,
	index,
	parentId,
	isLocked: false,
	opacity: 1,
	meta: { by },
})

/** A tldraw record from a simple shape */
function record({ type, x, y, w, h, text = '', color, id }, parentId, index, records, by) {
	if (typeof x !== 'number' || typeof y !== 'number') throw new Error(`A ${type} needs x and y`)
	const geo = type === 'circle' ? 'ellipse' : type
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
						geo,
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
	const shape = {
		...base(newId(id, records), x, y, index, parentId, by),
		type: ['text', 'note'].includes(type) ? type : 'geo',
		props,
	}
	schema.types.shape.validate(shape)
	return shape
}

/** An arrow from one shape's middle to another's, and the two bindings that keep its ends on them */
function arrow({ from, to, text = '', color, id }, parentId, index, records, by) {
	const [start, end] = [from, to].map((end, at) => {
		const shape = records[`shape:${end}`]
		if (end === undefined) throw new Error(`An arrow needs ${at ? 'to' : 'from'}: a shape's id`)
		if (shape?.typeName !== 'shape') throw new Error(`No shape ${end} to point an arrow at`)
		return shape
	})
	const head = middle(start, records),
		tail = middle(end, records)
	const shape = {
		...base(newId(id, records), head.x, head.y, index, parentId, by),
		type: 'arrow',
		props: {
			kind: 'arc',
			labelColor: 'black',
			color: color ?? 'black',
			fill: 'none',
			dash: 'draw',
			size: 'm',
			arrowheadStart: 'none',
			arrowheadEnd: 'arrow',
			font: 'draw',
			start: { x: 0, y: 0 },
			end: { x: tail.x - head.x, y: tail.y - head.y },
			bend: 0,
			richText: toRichText(text),
			labelPosition: 0.5,
			scale: 1,
			elbowMidPoint: 0.5,
		},
	}
	schema.types.shape.validate(shape)
	const bindings = [
		['start', start],
		['end', end],
	].map(([terminal, target]) => {
		const binding = {
			id: `binding:${crypto.randomUUID().slice(0, 8)}`,
			typeName: 'binding',
			type: 'arrow',
			fromId: shape.id,
			toId: target.id,
			props: {
				terminal,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
				snap: 'none',
			},
			meta: {},
		}
		schema.types.binding.validate(binding)
		return binding
	})
	return [shape, ...bindings]
}

/** A shape with what an agent changed: its place on the page, size, label or colour */
function updated({ id, x, y, w, h, text, color }, records, by) {
	const shape = records[`shape:${id}`]
	if (shape?.typeName !== 'shape') throw new Error(`No shape ${id}`)
	const at = onPage(shape, records)
	const props = { ...shape.props }
	if (w !== undefined || h !== undefined) {
		if (shape.type === 'geo') Object.assign(props, { w: w ?? props.w, h: h ?? props.h, growY: 0 })
		else if (shape.type === 'note' && w !== undefined) props.scale = w / NOTE
		else if (shape.type === 'text' && w !== undefined) Object.assign(props, { w, autoSize: false })
		else if ('w' in props && 'h' in props)
			Object.assign(props, { w: w ?? props.w, h: h ?? props.h })
		else throw new Error(`A ${shape.type} can't be resized here`)
	}
	if (text !== undefined) {
		if (!('richText' in props)) throw new Error(`A ${shape.type} has no label`)
		props.richText = toRichText(text)
	}
	if (color !== undefined) {
		if (!('color' in props)) throw new Error(`A ${shape.type} has no colour`)
		props.color = color
	}
	const next = stamped(
		{
			...shape,
			// x and y are on the page; the record keeps them from its parent
			x: shape.x + (x ?? at.x) - at.x,
			y: shape.y + (y ?? at.y) - at.y,
			props,
		},
		by,
	)
	schema.types.shape.validate(next)
	return next
}
