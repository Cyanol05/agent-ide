/** With memory, a model with a million-token window still gets a cut that merges its old lines: the memory's budget stops at 64 KiB, as the memory popover's does */
import {
	answered,
	api,
	check,
	conversationOf,
	done,
	linesOf,
	say,
	scriptedRunner,
	server,
	text,
	until,
} from './lib.js'

const route = (request) => {
	const first = text(request.messages.find((m) => m.role === 'user'))
	return say(first.includes('<input>') ? `L ${'x'.repeat(490)}` : 'ok')
}
const filler = (k) => `filler ${k} ${'z'.repeat(500 - `filler ${k} `.length)}`
const agent = { runner: 'bot', model: 'echo/echo' }

const srv = await server({ MODULES: '+memory' })
await scriptedRunner('bot', route, { model: { contextWindow: 1000000 } })
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'roomy' })

let k = 0
for (; k < 160; k++) await api('POST', `/api/threads/${id}/entries`, { body: filler(k), to: null })
await api('POST', `/api/threads/${id}/entries`, { body: 'go A', to: agent })
await answered(id, 1, 20000)
for (; k < 330; k++) await api('POST', `/api/threads/${id}/entries`, { body: filler(k), to: null })
const built = await until(
	async () => {
		const ls = await linesOf(id)
		return (
			ls.filter((x) => x.l === 0).length === 332 &&
			ls.filter((x) => x.l === 1 && x.i < 80).length === 80
		)
	},
	60000,
	500,
)
check(Boolean(built), 'every message has its line, and the old ones their merges')
await api('POST', `/api/threads/${id}/entries`, { body: 'go B', to: agent })
await answered(id, 2, 60000)

const { status } = await api('POST', `/api/threads/${id}/compact`, {})
const conversation = await conversationOf(
	(await api('GET', `/api/threads/${id}`)).json,
	'echo/echo@bot',
)
const compaction = conversation?.entries.find((e) => e.kind === 'pi.compaction')
const summary = text(compaction?.model?.[0] ?? {})
check(status < 300 && summary.includes('<chat>'), 'the agent is compacted into its memory', status)
const chat = summary.slice(summary.indexOf('<chat>\n') + 7, summary.indexOf('\n</chat>'))
const heads = chat
	.split('\n')
	.map((l) => l.match(/^(\d+)\+(\d+)\|/))
	.filter(Boolean)
	.map((m) => Number(m[2]))
check(
	heads.length > 0 && heads[0] > 1 && heads.at(-1) === 1,
	'a million-token window still hands over merged lines for the old stretch, one per message for the recent',
	JSON.stringify([heads.length, heads[0], heads.at(-1)]),
)
check(Buffer.byteLength(chat) <= 64 * 1024, 'and they fit in 64 KiB', Buffer.byteLength(chat))

srv.kill()
done()
