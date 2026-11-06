/**
 * With memory, an agent's context is compacted into the lines once it passes memory's `compactAt`, long before its
 * window is full, between model calls and never between a tool call and its result
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
	answered,
	api,
	call,
	check,
	conversationOf,
	dir,
	done,
	say,
	scriptedRunner,
	server,
	text,
} from './lib.js'

mkdirSync(dir, { recursive: true })
writeFileSync(
	path.join(dir, 'agent-ide.json'),
	JSON.stringify({ modules: ['+memory'], memory: { compactAt: 30000 } }),
)
await server({}, { cwd: dir })
// A window of a million tokens, so only memory's threshold can start a compaction
await scriptedRunner(
	'bot',
	(request) => {
		const first = text(request.messages.find((m) => m.role === 'user'))
		if (first.includes('<input>')) return say(`L ${'x'.repeat(200)}`)
		// Each turn reads a big file, then answers
		return request.messages.at(-1).role === 'toolResult'
			? say('ok')
			: call('bash', { command: 'seq 1 9000' })
	},
	{ model: { contextWindow: 1000000 } },
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'long' })

const agent = { runner: 'bot', model: 'echo/echo' }
let compaction
for (let turn = 1; turn <= 12 && !compaction; turn++) {
	await api('POST', `/api/threads/${id}/entries`, {
		body: `turn ${turn} ${'w'.repeat(4000)}`,
		to: agent,
	})
	const v = await answered(id, turn, 30000)
	compaction = (await conversationOf(v, 'echo/echo@bot'))?.entries.find(
		(e) => e.kind === 'pi.compaction',
	)
}
const conversation = await conversationOf(
	(await api('GET', `/api/threads/${id}`)).json,
	'echo/echo@bot',
)
check(Boolean(compaction), 'past compactAt the agent is compacted, a million-token window or not')
check(text(compaction?.model?.[0]).includes('<chat>'), 'its summary is the memory lines')
const kept = conversation.entries.find((e) => e.id === compaction?.head)
check(
	kept && kept.model?.[0]?.role !== 'toolResult',
	'the cut falls before a model call or a delivery, never between a tool call and its result',
	JSON.stringify(kept?.model?.[0]?.role ?? kept?.kind),
)
done()
