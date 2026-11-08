/** Automatic and manual compaction use the thread's memory, bounded even with a million-token window. */
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

await server({ MODULES: '+memory' })
for (const [runner, contextWindow, count, half, lineSize] of [
	['automatic', 40000, 310, 140, 300],
	['manual', 1000000, 330, 160, 492],
]) {
	const requests = []
	await scriptedRunner(
		runner,
		(request) => {
			requests.push(request.messages.map(text).join('\n'))
			const first = text(request.messages.find((message) => message.role === 'user'))
			return say(first.includes('<input>') ? `L ${'x'.repeat(lineSize - 2)}` : 'ok')
		},
		{ model: { contextWindow } },
	)
	const agent = { runner, model: 'echo/echo' }
	const {
		json: { id },
	} = await api('POST', '/api/threads', { title: runner })
	await api('POST', `/api/threads/${id}/memory`, { on: true })
	const post = (body, to = null) => api('POST', `/api/threads/${id}/entries`, { body, to })
	let position = 0
	const fill = async (end) => {
		for (; position < end; position++)
			await post(`filler ${position} ${'z'.repeat(500 - `filler ${position} `.length)}`)
	}
	await fill(half)
	await post('go A', agent)
	await answered(id, 1, 20000)
	await fill(count)
	check(
		Boolean(
			await until(
				async () => {
					const lines = await linesOf(id)
					return (
						lines.filter((line) => line.l === 0).length === count + 2 &&
						lines.filter((line) => line.l === 1 && line.i < half / 2).length === half / 2
					)
				},
				60000,
				500,
			),
		),
		`${runner}: every message has its line, and old lines their merges`,
	)
	await post('go B', agent)
	const view = await answered(id, 2, 60000)
	check(
		view.agents[0].contextWindow === contextWindow,
		`${runner}: the thread reports its context window`,
	)
	const conversation = () => conversationOf(view, `echo/echo@${runner}`)
	if (runner === 'manual') {
		check(
			!(await conversation()).entries.some((entry) => entry.kind === 'pi.compaction'),
			'with room to spare, nothing is compacted',
		)
		const { status, json } = await api('POST', `/api/threads/${id}/compact`, {})
		check(
			status < 300 && json.compacted?.length === 1,
			'compacting by hand answers for the thread’s agent',
		)
	}
	const compaction = (await conversation()).entries.find((entry) => entry.kind === 'pi.compaction')
	const summary = text(compaction?.model?.[0] ?? {})
	check(
		summary.includes('<chat>'),
		`${runner}: the conversation is compacted with memory as its summary`,
	)
	const chat = summary.slice(summary.indexOf('<chat>\n') + 7, summary.indexOf('\n</chat>'))
	const heads = chat
		.split('\n')
		.map((line) => line.match(/^(\d+)\+(\d+)\|/))
		.filter(Boolean)
		.map((match) => [Number(match[1]), Number(match[2])])
	check(
		heads.length > 0 &&
			heads.every(
				([at, size], index) => at === (index ? heads[index - 1][0] + heads[index - 1][1] : 0),
			) &&
			heads.reduce((sum, [, size]) => sum + size, 0) === half + 1,
		`${runner}: memory covers the cut exactly, from position 0`,
		JSON.stringify(heads),
	)
	check(
		heads[0]?.[1] > 1 && heads.at(-1)?.[1] === 1,
		`${runner}: old lines are merged, recent messages stay whole`,
		JSON.stringify(heads),
	)
	check(
		Buffer.byteLength(chat) <= Math.min(contextWindow, 64 * 1024),
		`${runner}: memory fits its budget, capped at 64 KiB`,
		Buffer.byteLength(chat),
	)
	check(
		!requests.some((request) => request.includes('context summarization assistant')),
		`${runner}: Pi's summariser never ran`,
	)
}
done()
