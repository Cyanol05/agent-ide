/**
 * A tldraw canvas for each thread, drawn on by people in the browser and by agents with `canvas_look` and `canvas_act`.
 * Off by default; MODULES=+canvas turns it on.
 *
 * The server holds one tldraw sync room per thread in use and keeps its snapshot in the thread's Canvas doc,
 * so a fork starts with the canvas as it was. A browser syncs over the socket at `/api/threads/:id/canvas?user=<name>&tab=<id>`.
 *
 * Agents see and change the canvas as tldraw's agent starter kit's own agent does, with its formats, actions,
 * sanitizers and lints (vendored in apps/client/canvas/agent). Those need a live editor, so the server hands each look
 * and batch of actions to a browser tab with the canvas open, the one someone used last, and answers what it found or
 * did: a look brings a picture of the area, at most 1000 px across, and what the person has selected and in view. With
 * no tab showing that canvas, the ade page someone used last (each offers itself over the socket at /api/canvas) brings
 * up an editor for it out of sight, within SUMMON_WAIT, and keeps it a minute. A tab that closes or doesn't answer within
 * HOST_WAIT, or no ade page open at all, leaves looks reading stored shapes with sizes guessed, and actions asking
 * for ade to be opened in a browser.
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
import { createTLSchema } from '@tldraw/tlschema'

export const on = false

/** The client loads this same version from esm.sh: the room and the editor must speak one protocol */
const version = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.resolve('@tldraw/sync-core')), 'utf8'),
).version
/** Changes are saved this long after they stop */
const SAVE = 500

/** How long a tab has to answer a look or a batch of actions before the request times out */
const HOST_WAIT = 5000
/** How long an ade page has to bring up an editor it wasn't showing, before the request times out */
const SUMMON_WAIT = 10000
/** How long after its actions land a tab's changes are still the agent's, for the sync that brings them */
const ACTED = 5000

/**
 * The actions agents get, as the starter kit's schemas (scripts/vendor-canvas-agent.js writes them), asking for less:
 * no `note`, the kit's memo to its own agent, which ade's agents don't read back; and of an update, only what changes
 */
const ACTIONS = JSON.parse(
	readFileSync(new URL('../apps/client/canvas/agent/actions.schema.json', import.meta.url), 'utf8'),
	(key, value) => {
		// An update names what changes; the rest stays as it is
		if (value?.properties?._type?.const === 'update')
			for (const shape of value.properties.update.anyOf)
				shape.required = shape.required.filter((name) => ['_type', 'shapeId'].includes(name))
		if (!value?.required) return value
		return { ...value, required: value.required.filter((name) => name !== 'note') }
	},
)
/** The starter kit's shape types and tldraw's geo kinds (its convertFocusedShapeToTldrawShape) */
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
		/** @type {InMemorySyncStorage<import('@tldraw/tlschema').TLRecord>} */
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
							if (shape?.typeName === 'shape' && shape.meta?.by !== by) txn.set(id, stamped(shape, by))
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
					('y' in one ? one.y : one.y1) - ('y' in other ? other.y : other.y1) ||
					('x' in one ? one.x : one.x1) - ('x' in other ? other.x : other.x1),
			)
	}

	/** Call → what waits for a tab's answer */
	const calls = new Map()

	/** The tab someone used last, of those with this thread's canvas open and ready */
	async function hostOf(threadId) {
		const room = rooms.get(threadId) && (await rooms.get(threadId))
		const [sessionId] =
			[...(room?.tabs ?? [])]
				.filter(([, tab]) => tab.ready && listening(tab.socket))
				.sort(([, one], [, other]) => other.active - one.active)[0] ?? []
		return sessionId && { ...room, sessionId }
	}

	/** Counts each use of a page or tab, so the one used last is the highest: two in one millisecond still have an order */
	let used = 0
	/** Every ade page open with this module on, by its id: its socket and the count when someone last used it */
	const pages = new Map()
	/** What waits for a tab to say it's ready */
	const arrivals = new Set()

	/**
	 * No tab shows this thread's canvas: the ade page someone used last brings up an editor for it out of sight, and
	 * that is the host until it goes. Undefined when no page is open, or none came up within SUMMON_WAIT.
	 */
	async function summon(threadId) {
		const [page] = [...pages.values()]
			.filter((page) => listening(page.socket))
			.sort((one, other) => other.active - one.active)
		if (!page) return undefined
		await open(threadId)
		try {
			return await new Promise((resolve) => {
				const settle = (host) => {
					clearTimeout(timer)
					arrivals.delete(arrived)
					resolve(host)
				}
				const arrived = async () => {
					const host = await hostOf(threadId)
					if (host) settle(host)
				}
				const timer = setTimeout(() => settle(undefined), SUMMON_WAIT)
				arrivals.add(arrived)
				// A page that closes first won't bring it up
				page.socket.once('close', () => settle(undefined))
				page.socket.send(JSON.stringify({ host: threadId }))
			})
		} finally {
			close(threadId)
		}
	}

	/**
	 * Hands a look or a batch of actions to the thread's host tab, and answers what it found or did; undefined when no
	 * tab is open, or the one asked closed, failed or took longer than HOST_WAIT.
	 */
	async function relay(threadId, request, by) {
		const anyPage = pages.size
		const host = (await hostOf(threadId)) ?? (await summon(threadId))
		if (!host)
			return {
				why: anyPage
					? 'the ade page asked to bring the canvas up closed, or took too long'
					: 'no ade page is open in a browser',
			}
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
			estimated: `No picture or lints, and sizes are guessed: ${answer.why ?? answer.error}.`,
		}
	}

	async function act(threadId, actions, by) {
		const answer = await relay(threadId, { act: { actions } }, by)
		if (answer.result) return answer.result
		return { error: 'Open ade in a browser to draw.' }
	}

	/** Who a tool call is: the bot's name, or the agent's model@runner, and its thread */
	const caller = async (api) => {
		const found = await core.home(api.conversationId)
		return { threadId: found?.thread, by: found?.name ?? 'an agent' }
	}

	const canvasLook = defineTool({
		name: 'canvas_look',
		description:
			"Look at your thread's canvas, where people in the thread draw with you. Without `bounds` you see the whole drawing, or, when it's big, the part the person has in view. Answers a picture of that area; its shapes as {shapeId, type, x, y, w, h, text, by}, `by` naming who drew or changed it last; what the person has selected (\"this box\" means one of those) and their view; the shapes elsewhere as clusters, {bounds, numberOfShapes}, to look at next; and lints: a box grown onto another shape to fit its label, labels overlapping, arrows joined to nothing. Look before you change what's there, and again after.",
		parameters: obj({
			bounds: opt(obj({ x: num(), y: num(), w: num(), h: num() })),
		}),
		replay: 'safe',
		execute: async ({ bounds }, api) => {
			const { picture, ...seen } = await look((await caller(api)).threadId, bounds)
			return {
				output: [
					{ type: 'text', text: JSON.stringify(seen) },
					...(picture ? [{ type: /** @type {const} */ ('image'), data: picture.data, mimeType: picture.mimeType }] : []),
				],
			}
		},
	})

	const canvasAct = defineTool({
		name: 'canvas_act',
		description:
			"Change your thread's canvas with tldraw's agent actions, in order, in one step a person can undo: create, update, delete, move, label, resize, rotate, align, distribute, stack, place, bringToFront, sendToBack, pen. Requires ade open in a browser. Refer to shapes by the shapeId canvas_look gives; an arrow created with fromId and toId stays joined to them when they move. Answers what each action did, the shapes it touched as they landed, with their real bounds, and the lints they now have: fix those in place, never by drawing again somewhere else.",
		parameters: obj({ actions: arr(ACTIONS) }),
		replay: 'unsafe',
		execute: async ({ actions }, api) => {
			const { threadId, by } = await caller(api)
			const done = await act(threadId, actions, by)
			return {
				output: [
					{ type: 'text', text: done.error ?? `${summary(done.applied)}\n${JSON.stringify(done)}` },
				],
			}
		},
	})

	return {
		extension: defineExtension({ name: 'ade.canvas', tools: [canvasLook, canvasAct] }),
		/**
		 * GET: the stored shapes, simply, and the tldraw version. POST {actions}: canvas_act as the person asking;
		 * {look: {bounds}}: canvas_look. And from a tab: {active: tab} says it's being used, {answer} answers a call.
		 */
		async serve(threadId, query, body, user) {
			if (threadId === undefined) {
				// An ade page someone just used, answered once it counts, so whoever asks next asks it
				const page = body?.active && pages.get(body.active)
				if (!page)
					throw new Error(
						'POST /api/canvas {active: page} from an open page; a canvas is at /api/threads/:id/canvas',
					)
				page.active = ++used
				return {}
			}
			if (body === undefined) return { shapes: await read(threadId), tldraw: version }
			if (Array.isArray(body.actions)) return act(threadId, body.actions, user)
			if (body.look) return look(threadId, body.look.bounds)
			if (body.active) {
				const room = rooms.get(threadId) && (await rooms.get(threadId))
				for (const [, tab] of room?.tabs ?? [])
					if (tab.tab === body.active) Object.assign(tab, { active: ++used, ready: true })
				for (const arrived of arrivals) arrived()
				return {}
			}
			if (body.answer) {
				const { call, result, error } = body.answer
				calls.get(call)?.settle(result ? { result } : { error: error ?? 'no answer' })
				return {}
			}
			throw new Error('POST {actions}, {look}, {active} or {answer}')
		},
		/**
		 * A browser's tldraw sync socket, at /api/threads/:id/canvas; `user` says who is drawing, `tab` which tab it is.
		 * Or, at /api/canvas?page=<id>, an ade page offering to bring up an editor for a canvas it isn't showing; it
		 * posts `{active: page}` to /api/canvas when someone uses it, and is sent `{host: threadId}`.
		 */
		async connect(threadId, socket, url) {
			if (threadId === undefined) {
				const id = url.searchParams.get('page')
				if (!id) return socket.close(4000, 'no page')
				const page = { socket, active: ++used }
				pages.set(id, page)
				socket.on('close', () => pages.get(id) === page && pages.delete(id))
				return
			}
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
			tabs.set(sessionId, { tab, socket, active: ++used, ready: false })
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

/**
 * Whether a socket still takes messages. A browser that closes one hears back before the server's `close` event comes,
 * so a call right after must already pass it by.
 */
const listening = (socket) => socket.readyState === socket.OPEN

/** Each action's past tense, for the line that says what a batch did */
const DID = {
	create: 'drew',
	pen: 'drew',
	update: 'changed',
	delete: 'deleted',
	move: 'moved',
	label: 'labelled',
	resize: 'resized',
	rotate: 'rotated',
	align: 'aligned',
	distribute: 'distributed',
	stack: 'stacked',
	place: 'placed',
	bringToFront: 'brought forward',
	sendToBack: 'sent back',
}

/**
 * What a batch did, in a few words, and what it didn't and why; the chat shows it as the call's row
 */
function summary(applied) {
	const counts = new Map()
	const why = new Map()
	for (const { _type, ok, skipped } of applied)
		if (ok) counts.set(DID[_type] ?? _type, (counts.get(DID[_type] ?? _type) ?? 0) + 1)
		else why.set(skipped, [...(why.get(skipped) ?? []), _type])
	const done = [...counts].map(([verb, n]) => `${verb} ${n}`).join(', ')
	const not = [...why].map(([reason, types]) => `${[...new Set(types)].join(', ')} (${reason})`)
	return `${done || 'did nothing'}${not.length ? `; not done: ${not.join('; ')}` : ''}`
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
	if (shape.type === 'text') return textSize(shape)
	if (props.w !== undefined && props.h !== undefined) return { w: props.w, h: props.h }
	return {}
}

/** tldraw's font sizes, for guessing a text's size with no editor to lay it out */
const FONT = { s: 18, m: 24, l: 36, xl: 44 }
/** A text's size as a guess: its lines at tldraw's line height, as wide as its longest line or its set width */
function textSize({ props }) {
	const lines = plain(props.richText ?? { type: 'doc' }).split('\n')
	const size = (FONT[props.size] ?? FONT.m) * (props.scale ?? 1)
	const longest = Math.max(...lines.map((line) => line.length))
	return {
		w: Math.round(props.autoSize ? Math.max(longest * size * 0.55, size) + 16 : props.w),
		h: Math.round(lines.length * size * 1.35 + 8),
	}
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
