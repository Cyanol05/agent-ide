/** A real model recalls a fact from before its compaction, zooming back into its memory. */
import { answers, api, linesOf, until } from './lib.js'
import {
	agent,
	bench,
	check,
	done,
	evidence,
	post,
	settled,
	steps,
	thread,
} from './real-model-bench.js'
await bench()
// A thread's own agent, not a bot, which could keep the note in its instructions instead
const home = await thread('recall')
await api('POST', `/api/threads/${home}/memory`, { on: true })
const prose = (topic, size) => {
	const sentence = `The ${topic} committee met again and spent the afternoon on schedules, budgets and the colour of the new signs. `
	return sentence.repeat(Math.ceil(size / sentence.length)).slice(0, size)
}
const half = prose('building', 3000)
const code = String(1000 + Math.floor(Math.random() * 9000))
await post(home, `${half} Note for later: the locker code is ${code}. ${half}`, null)
await post(home, 'Note this.', agent)
await settled()
// Its line first, so the compaction's memory holds it
await until(async () => (await linesOf(home)).some((x) => x.l === 0 && x.i === 0), 120000, 1000)
// Past what Pi keeps word for word, so the note is only in the memory after the cut
for (let k = 0; k < 40; k++) await post(home, prose(`garden ${k}`, 4000), null)
await post(home, 'Anything stand out?', agent)
await settled(300000)
const { status, json } = await api('POST', `/api/threads/${home}/compact`, {})
check(status < 300 && json.compacted?.length === 1, 'the conversation is compacted by hand')
const [before] = await evidence([home])
const boundary = before.entries.at(-1)?.id || 0
await post(home, "What exactly is the locker code? Zoom if your memory isn't word for word.", agent)
await settled(300000)
const [result] = await evidence([home])
const name = result.agents[0].name
const conversation = result.conversations[name]
const last =
	answers(result)
		.filter((entry) => entry.id > boundary)
		.at(-1)?.data.body ?? ''
check(
	conversation.entries.some((entry) => entry.kind === 'pi.compaction'),
	"the agent's conversation was compacted",
)
check(last.includes(code), 'the answer has the locker code')
check(
	result.calls.some((call) => call.name === 'zoom'),
	'the agent zoomed',
)
steps(name, 4)
done()
