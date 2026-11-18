/**
 * A tldraw canvas for each thread, drawn on by people in the browser and by agents with `canvas_look` and `canvas_act`.
 * Off by default; MODULES=+canvas turns it on.
 *
 * The server holds one tldraw sync room per thread that someone has open or an agent draws on, and keeps its snapshot in
 * the thread's Canvas doc, so an agent draws with no browser open and a fork starts with the canvas as it was. A browser
 * syncs over the socket at `/api/threads/:id/canvas?user=<name>&tab=<id>`.
 *
 * Agents see and change the canvas as tldraw's agent starter kit's own agent does, with its formats, actions,
 * sanitizers and lints (vendored in apps/client/canvas/agent). Those need a live editor, so the server hands each look
 * and batch of actions to a browser tab with the canvas open, the one someone used last, and answers what it found or
 * did. With no tab, or one that closes or doesn't answer within HOST_WAIT, the server does what needs no layout itself:
 * create, update, delete, move and label, with sizes guessed, and says so; other actions need a tab.
 *
 * `by` on a shape is who drew or changed it last: the person, or the bot's name, or the agent's model@runner, kept in its
 * `meta.by`. `GET /api/threads/:id/canvas` answers `{shapes, tldraw}`: the stored shapes, simply, and the tldraw version
 * the client loads, the same as the server's, to speak the room's protocol. `POST {actions}` acts and `{look: {bounds}}`
 * looks, as the tools do; a tab posts `{active: tab}` when it's used and `{answer: {call, result | error}}`.
 *
 * The tab needs the internet the first time it opens, to load tldraw from esm.sh. On localhost or plain http tldraw runs
 * without a licence key and shows its watermark; served over https at a domain it would need a key.
 */
import { readFileSync } from 'node:fs'
import { arr, num, obj, opt } from '@earendil-works/pi-schema'
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

/** How long a tab has to answer a look or a batch of actions before the server does what it can alone */
const HOST_WAIT = 5000
/** How long after its actions land a tab's changes are still the agent's, for the sync that brings them */
const ACTED = 5000

/** The actions agents get, as the starter kit's schemas; scripts/vendor-canvas-agent.js writes it */
const ACTIONS = JSON.parse(
	readFileSync(new URL('../apps/client/canvas/agent/actions.schema.json', import.meta.url), 'utf8'),
)
/** What the server does with no tab to ask: what needs no layout */
const ALONE = ['create', 'update', 'delete', 'move', 'label']

/** The starter kit's shape types and tldraw's geo kinds, both ways (its convertFocusedShapeToTldrawShape) */
const GEO = {
	rectangle: 'rectangle',
	ellipse: 'ellipse',
	triangle: 'triangle',
	diamond: 'diamond',
	hexagon: 'hexagon',
	pill: 'oval',
	cloud: 'cloud',
	'x-box': 'x-box',
	'check-box': 'check-box',
	heart: 'heart',
	pentagon: 'pentagon',
	octagon: 'octagon',
	star: 'star',
	'parallelogram-right': 'rhombus',
	'parallelogram-left': 'rhombus-2',
	trapezoid: 'trapezoid',
	'fat-arrow-right': 'arrow-right',
	'fat-arrow-left': 'arrow-left',
	'fat-arrow-up': 'arrow-up',
	'fat-arrow-down': 'arrow-down',
}
const FOCUSED = Object.fromEntries(Object.entries(GEO).map(([focused, geo]) => [geo, focused]))
/** The starter kit's fills and tldraw's (its FocusedFill) */
const FILLS = {
	none: 'none',
	solid: 'lined-fill',
	background: 'semi',
	tint: 'solid',
	pattern: 'pattern',
}
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
		/** Session → its tab and when it was last used, while its socket is open */
		const tabs = new Map()
		/** Session → the agent whose actions it is applying, and until when its changes are that agent's */
		const acting = new Map()
		const whose = (session) => {
			const agent = acting.get(session.sessionId)
			return agent && agent.until > Date.now() ? agent.by : session.meta.by
		}
		const room = new TLSocketRoom({
			schema,
			storage,
			// A person's new shape is theirs as it lands; a change to someone else's is stamped right after
			authorizeRecord: {
				shape: ({ session, type, prev, next }) => {
					const by = whose(session)
					if (type === 'create') return { ...next, meta: { ...next.meta, by } }
					if (type === 'update' && next.meta?.by !== by) touched.set(next.id, by)
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
		return { room, storage, save, tabs, acting }
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

	/**
	 * A batch of actions done here, with no tab to ask: create, update, delete, move and label, one at a time on the
	 * stored shapes, with sizes guessed, since only an editor lays text out. The rest need a tab.
	 */
	const alone = (threadId, actions, by) =>
		change(threadId, (records) => {
			const all = { ...records }
			const gone = new Set()
			const touched = new Set()
			const renamed = {}
			const applied = actions.map((action) => {
				const type = action?._type
				if (!ALONE.includes(type))
					return { _type: type, skipped: 'needs the canvas open in a browser' }
				try {
					for (const record of apply(action, all, by, renamed)) {
						if (record.gone) {
							delete all[record.id]
							gone.add(record.id)
						} else {
							all[record.id] = record
							touched.add(record.id)
						}
					}
					return { _type: type, ok: true }
				} catch (error) {
					return { _type: type, skipped: error.message }
				}
			})
			return {
				set: [...touched].filter((id) => all[id]).map((id) => all[id]),
				remove: [...gone],
				answer: (now) => ({
					applied,
					shapes: [...touched]
						.filter((id) => now[id]?.typeName === 'shape')
						.map((id) => blurry(simple(now[id], now))),
					deleted: [...gone].filter((id) => id.startsWith('shape:')).map(short),
					renamed,
					lints: [],
				}),
			}
		})

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

	/** Call → what waits for a tab's answer */
	const calls = new Map()

	/** The tab someone used last, of those with this thread's canvas open */
	async function hostOf(threadId) {
		const room = rooms.get(threadId) && (await rooms.get(threadId))
		const [sessionId] =
			[...(room?.tabs ?? [])].sort(([, one], [, other]) => other.active - one.active)[0] ?? []
		return sessionId && { ...room, sessionId }
	}

	/**
	 * Hands a look or a batch of actions to the thread's host tab, and answers what it found or did; undefined when no
	 * tab is open, or the one asked closed, failed or took longer than HOST_WAIT.
	 */
	async function relay(threadId, request, by) {
		const host = await hostOf(threadId)
		if (!host) return { why: 'no browser has the canvas open' }
		const call = crypto.randomUUID()
		if (request.act) host.acting.set(host.sessionId, { by, until: Infinity })
		try {
			return await new Promise((resolve) => {
				const timer = setTimeout(
					() => settle({ why: `the browser didn't answer in ${HOST_WAIT / 1000} s` }),
					HOST_WAIT,
				)
				const settle = (answer) => {
					clearTimeout(timer)
					calls.delete(call)
					resolve(answer)
				}
				calls.set(call, { sessionId: host.sessionId, settle })
				host.room.sendCustomMessage(host.sessionId, { call, ...request })
			})
		} finally {
			if (request.act) host.acting.set(host.sessionId, { by, until: Date.now() + ACTED })
		}
	}

	async function look(threadId, bounds) {
		const answer = await relay(threadId, { look: { bounds } })
		if (answer.result) return answer.result
		return {
			bounds: bounds ?? null,
			shapes: (await read(threadId, bounds)).map(blurry),
			estimated: `Sizes are guessed and there are no lints: ${answer.why ?? answer.error}.`,
		}
	}

	async function act(threadId, actions, by) {
		const answer = await relay(threadId, { act: { actions } }, by)
		if (answer.result) return answer.result
		return {
			...(await alone(threadId, actions, by)),
			estimated: `Done on the stored canvas, sizes guessed: ${answer.why ?? answer.error}.`,
		}
	}

	/** Who a tool call is: the bot's name, or the agent's model@runner, and its thread */
	const caller = async (api) => {
		const found = await core.home(api.conversationId)
		return { threadId: found?.thread, by: found?.name ?? 'an agent' }
	}
	const text = (value) => ({ output: [{ type: 'text', text: value }] })

	const canvasLook = defineTool({
		name: 'canvas_look',
		description:
			"Look at your thread's canvas, where people in the thread draw with you. Answers the shapes in `bounds` (by default the area the person has in view) as {shapeId, type, x, y, w, h, text, by}, `by` naming who drew or changed it last; the rest as clusters, {bounds, numberOfShapes}, to look at next; and lints: text overflowing its shape, labels overlapping, arrows joined to nothing. Look before you change what's there, and again after.",
		parameters: obj({
			bounds: opt(obj({ x: num(), y: num(), w: num(), h: num() })),
		}),
		replay: 'safe',
		execute: async ({ bounds }, api) =>
			text(JSON.stringify(await look((await caller(api)).threadId, bounds))),
	})

	const canvasAct = defineTool({
		name: 'canvas_act',
		description:
			"Change your thread's canvas with tldraw's agent actions, in order, in one step a person can undo: create, update, delete, move, label, resize, rotate, align, distribute, stack, place, bringToFront, sendToBack, pen. Refer to shapes by the shapeId canvas_look gives; an arrow created with fromId and toId stays joined to them when they move. Answers what each action did, the shapes it touched as they landed, with their real bounds, and the lints they now have: fix those in place, never by drawing again somewhere else.",
		parameters: obj({ actions: arr(ACTIONS) }),
		replay: 'unsafe',
		execute: async ({ actions }, api) => {
			const { threadId, by } = await caller(api)
			const done = await act(threadId, actions, by)
			return text(`${summary(done.applied)}\n${JSON.stringify(done)}`)
		},
	})

	return {
		extension: defineExtension({ name: 'ade.canvas', tools: [canvasLook, canvasAct] }),
		/**
		 * GET: the stored shapes, simply, and the tldraw version. POST {actions}: canvas_act as the person asking;
		 * {look: {bounds}}: canvas_look. And from a tab: {active: tab} says it's being used, {answer} answers a call.
		 */
		async serve(threadId, query, body, user) {
			if (threadId === undefined) throw new Error('A canvas belongs to a thread')
			if (body === undefined) return { shapes: await read(threadId), tldraw: version }
			if (Array.isArray(body.actions)) return act(threadId, body.actions, user)
			if (body.look) return look(threadId, body.look.bounds)
			if (body.active) {
				const room = rooms.get(threadId) && (await rooms.get(threadId))
				for (const [, tab] of room?.tabs ?? []) if (tab.tab === body.active) tab.active = Date.now()
				return {}
			}
			if (body.answer) {
				const { call, result, error } = body.answer
				calls.get(call)?.settle(result ? { result } : { error: error ?? 'no answer' })
				return {}
			}
			throw new Error('POST {actions}, {look}, {active} or {answer}')
		},
		/** A browser's tldraw sync socket; `user` says who is drawing, `tab` which tab it is */
		async connect(threadId, socket, url) {
			const sessionId = url.searchParams.get('sessionId')
			if (!sessionId) return socket.close(4000, 'no sessionId')
			const { room, tabs } = await open(threadId)
			room.handleSocketConnect({
				sessionId,
				socket,
				meta: { by: speaker(url.searchParams.get('user')) },
			})
			const tab = url.searchParams.get('tab')
			if (!tab) return
			tabs.set(sessionId, { tab, active: Date.now() })
			socket.on('close', () => {
				if (tabs.get(sessionId)?.tab !== tab) return
				tabs.delete(sessionId)
				for (const [, waiting] of calls)
					if (waiting.sessionId === sessionId)
						waiting.settle({ why: 'the browser closed the canvas' })
			})
		},
	}
}

/** What a batch did, in a few words: "moved 3, deleted 1; 1 skipped" */
function summary(applied) {
	const counts = new Map()
	for (const { _type, ok } of applied) if (ok) counts.set(_type, (counts.get(_type) ?? 0) + 1)
	const skipped = applied.filter((one) => !one.ok).length
	const done = [...counts].map(([type, n]) => `${type} ${n}`).join(', ')
	return `${done || 'nothing done'}${skipped ? `; ${skipped} skipped` : ''}`
}

/** A stored shape as the starter kit's blurry shape: its id, type, bounds and text */
function blurry(shape) {
	const box =
		shape.type === 'arrow'
			? {
					x: Math.min(shape.x1, shape.x2),
					y: Math.min(shape.y1, shape.y2),
					w: Math.abs(shape.x2 - shape.x1),
					h: Math.abs(shape.y2 - shape.y1),
				}
			: { x: shape.x, y: shape.y, w: shape.w ?? 0, h: shape.h ?? 0 }
	return {
		shapeId: shape.id,
		type: FOCUSED[shape.type] ?? shape.type,
		...box,
		...(shape.text && { text: shape.text }),
		...(shape.by && { by: shape.by }),
	}
}

/** An id no shape has, as the starter kit's ensureShapeIdIsUnique makes one: box, box-1, box-2 */
function unique(id, records) {
	let next = id
	while (records[`shape:${next}`])
		next = /\d+$/.test(next) ? next.replace(/\d+$/, (n) => String(+n + 1)) : `${next}-1`
	return next
}

/** Where an anchor sits on a box, as the starter kit's move has it */
function anchored(anchor = 'top-left', { w = 0, h = 0 }) {
	const [vertical, horizontal] = anchor === 'center' ? ['center', 'center'] : anchor.split('-')
	return {
		x: { left: 0, center: w / 2, right: w }[horizontal] ?? 0,
		y: { top: 0, center: h / 2, bottom: h }[vertical] ?? 0,
	}
}

/** One action on the stored records, as the records it changes; a deleted one is {id, gone: true} */
function apply(action, records, by, renamed) {
	const page = Object.values(records)
		.filter((record) => record.typeName === 'page')
		.sort(byIndex)[0]
	const shapeOf = (id) => {
		if (records[`shape:${id}`]?.typeName !== 'shape') throw new Error(`no shape ${id}`)
		return records[`shape:${id}`]
	}
	switch (action._type) {
		case 'create': {
			const shape = action.shape ?? {}
			const top = Object.values(records)
				.filter((record) => record.typeName === 'shape' && record.parentId === page.id)
				.sort(byIndex)
				.at(-1)?.index
			const [index] = getIndicesAbove(top, 1)
			const id = shape.shapeId && unique(shape.shapeId, records)
			if (id !== shape.shapeId) renamed[shape.shapeId] = id
			if (shape._type === 'arrow') {
				if (!shape.fromId || !shape.toId)
					throw new Error('an arrow not joined to two shapes needs the canvas open in a browser')
				return arrow(
					{ from: shape.fromId, to: shape.toId, text: shape.text, color: shape.color, id },
					page.id,
					index,
					records,
					by,
				)
			}
			const type = GEO[shape._type] ?? shape._type
			if (!['note', 'text', ...Object.values(GEO)].includes(type))
				throw new Error(`a ${shape._type} needs the canvas open in a browser`)
			return [
				record(
					{
						...shape,
						type,
						id,
						fill: FILLS[shape.fill],
						w: shape.w ?? shape.maxWidth ?? undefined,
					},
					page.id,
					index,
					records,
					by,
				),
			]
		}
		case 'update': {
			const { shapeId, x, y, w, h, text, color, _type } = action.update ?? {}
			shapeOf(shapeId)
			return [
				updated(
					_type === 'arrow'
						? { id: shapeId, text, color }
						: { id: shapeId, x, y, w, h, text, color },
					records,
					by,
				),
			]
		}
		case 'label':
			shapeOf(action.shapeId)
			return [updated({ id: action.shapeId, text: action.text }, records, by)]
		case 'move': {
			const shape = shapeOf(action.shapeId)
			const offset = anchored(action.anchor, sizeOf(shape))
			return [
				updated(
					{ id: action.shapeId, x: action.x - offset.x, y: action.y - offset.y },
					records,
					by,
				),
			]
		}
		case 'delete': {
			shapeOf(action.shapeId)
			const gone = new Set([`shape:${action.shapeId}`])
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
			return [
				...loosened,
				...[...gone, ...bindings.map((binding) => binding.id)].map((id) => ({ id, gone: true })),
			]
		}
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

/** A tldraw record from a simple shape, with the starter kit's defaults */
function record({ type, x, y, w, h, text = '', color, fill, id }, parentId, index, records, by) {
	if (typeof x !== 'number' || typeof y !== 'number') throw new Error(`A ${type} needs x and y`)
	const geo = type
	const richText = toRichText(text)
	const props =
		type === 'text'
			? {
					color: color ?? 'black',
					size: 's',
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
						size: 's',
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
						w: w ?? 100,
						h: h ?? 100,
						growY: 0,
						scale: 1,
						flipX: false,
						flipY: false,
						labelColor: 'black',
						color: color ?? 'black',
						fill: fill ?? 'none',
						size: 's',
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
