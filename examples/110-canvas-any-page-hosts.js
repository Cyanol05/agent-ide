/** With no tab showing a canvas, the ade page used last brings up an editor for it and answers; with no page open at all, the server does what it can and names what it couldn't. */
import { getTlsyncProtocolVersion } from '@tldraw/sync-core'
import { createTLSchema } from '@tldraw/tlschema'
import { api, base, check, done, server, until } from './lib.js'

await server({ MODULES: '+canvas,-auto-title,-director' })
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Hosted' })
const path = `/api/threads/${id}/canvas`
const box = (shapeId, x) => ({
	_type: 'create',
	intent: shapeId,
	shape: {
		_type: 'rectangle',
		shapeId,
		x,
		y: 0,
		w: 100,
		h: 100,
		color: 'black',
		fill: 'none',
		note: '',
	},
})
const stack = {
	_type: 'stack',
	intent: 'tidy',
	direction: 'vertical',
	gap: 20,
	shapeIds: ['a', 'b'],
}

// No page open anywhere: the stored shapes, and every action it couldn't do named
const alone = (await api('POST', path, { actions: [box('a', 0), box('b', 200), stack] })).json
check(
	alone.estimated?.includes('no ade page is open in a browser') &&
		alone.applied[2].skipped === 'needs an ade page open in a browser',
	'with no ade page open, the server draws alone and says stack needs a page',
	JSON.stringify(alone),
)

const ws = (route) => new WebSocket(`${base.replace(/^http/, 'ws')}${route}`)
const opened = (socket) => new Promise((resolve) => (socket.onopen = resolve))

/**
 * An ade page, as the client's offerToHost is one: told to host a thread, it brings up an editor's tab for it, as
 * tldraw's client connects, says it's ready, and answers each call with its own name
 */
function page(name) {
	const socket = ws('/api/canvas')
	const asked = []
	const tabs = []
	socket.onmessage = async (event) => {
		const { host } = JSON.parse(String(event.data))
		asked.push(host)
		const tab = ws(
			`/api/threads/${host}/canvas?sessionId=${name}-${host}&tab=${name}-${host}&user=ana`,
		)
		tabs.push(tab)
		const heard = []
		tab.onmessage = (frame) => {
			heard.push(String(frame.data))
			const message = JSON.parse(String(frame.data))
			for (const one of Array.isArray(message) ? message : [message])
				if (one.type === 'custom' && one.data?.call)
					api('POST', `/api/threads/${host}/canvas`, {
						answer: {
							call: one.data.call,
							result: one.data.look
								? { shapes: [], lints: [], by: name }
								: {
										applied: one.data.act.actions.map(({ _type }) => ({ _type, ok: true })),
										shapes: [],
										deleted: [],
										lints: [],
										by: name,
									},
						},
					})
		}
		await opened(tab)
		tab.send(
			JSON.stringify({
				type: 'connect',
				connectRequestId: name,
				schema: createTLSchema().serialize(),
				protocolVersion: getTlsyncProtocolVersion(),
				lastServerClock: 0,
			}),
		)
		await until(async () => heard.some((frame) => frame.includes('"connect"')))
		await api('POST', `/api/threads/${host}/canvas`, { active: `${name}-${host}` })
	}
	return { socket, asked, tabs, used: () => socket.send(JSON.stringify({ active: true })) }
}

const one = page('one')
const two = page('two')
await Promise.all([opened(one.socket), opened(two.socket)])
one.used()
await new Promise((resolve) => setTimeout(resolve, 20))
two.used()
await until(async () => true)

const looked = (await api('POST', path, { look: {} })).json
check(
	looked.by === 'two' && two.asked[0] === id && !one.asked.length,
	'a look with no tab showing the canvas goes to the page used last, which brings an editor up',
	JSON.stringify(looked),
)
const acted = (await api('POST', path, { actions: [stack] })).json
check(
	acted.by === 'two' && acted.applied[0].ok && two.asked.length === 1,
	'and the next call goes to that editor, still up, without asking again',
	JSON.stringify(acted),
)

// The page closes its editor and then itself; the other page, still open, is asked next
const closed = (socket) =>
	new Promise((resolve) => {
		socket.onclose = resolve
		socket.close()
	})
await Promise.all([...two.tabs, two.socket].map(closed))
const again = (await api('POST', path, { look: {} })).json
check(
	again.by === 'one' && one.asked[0] === id,
	'when it goes, the other open page brings one up',
	JSON.stringify(again),
)

// A page that closes rather than bring an editor up leaves the call to the server, which says so
await Promise.all(one.tabs.map(closed))
one.socket.onmessage = () => one.socket.close()
const fell = (await api('POST', path, { actions: [stack] })).json
check(
	fell.estimated?.includes('closed, or took too long') && fell.applied[0].skipped,
	'a page that closes instead leaves the call to the server, which says why',
	JSON.stringify(fell),
)

done()
