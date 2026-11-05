/** Ask two at once: one message starts two threads, one agent in each, side by side like forks */
import {
	answered,
	answers,
	api,
	brief,
	call,
	check,
	conversationOf,
	done,
	say,
	scriptedRunner,
	server,
	sleep,
	text,
	until,
	view,
} from './lib.js'

await server()
const thinks = (who) => () => say(`${who} thinks ${'hmm '.repeat(150)}`)
const ann = await scriptedRunner('ann', thinks('ann'))
const bob = await scriptedRunner('bob', thinks('bob'))
const toAnn = { runner: 'ann', model: 'echo/echo' }
const toBob = { runner: 'bob', model: 'echo/echo' }

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'two' })
const asked = await api('POST', `/api/threads/${id}/entries`, {
	body: 'what is 2+2?',
	to: [toAnn, toBob],
})
const [fork] = asked.json.forks ?? []
check(
	asked.status === 201 && asked.json.to.join() === 'echo/echo@ann' && Boolean(fork),
	'one message to two models asks the first here and starts a fork for the second',
	JSON.stringify(asked.json),
)
const both = await until(
	async () => {
		const [a, b] = [await view(id), await view(fork)]
		return a.agents.length === 1 &&
			b.agents.length === 1 &&
			a.status === 'working' &&
			b.status === 'working'
			? [a, b]
			: null
	},
	8000,
	20,
)
check(Boolean(both), 'each thread has one agent, and both work at once', JSON.stringify(both))

const [here, there] = [await answered(id), await answered(fork)]
check(
	answers(here)[0]?.data.author === 'echo/echo@ann' &&
		answers(there)[0]?.data.author === 'echo/echo@bob' &&
		JSON.stringify(answers(there)[0]?.data.re) === JSON.stringify([asked.json.entry]),
	'each answers the same question, from its own machine',
	brief(here) + brief(there),
)
check(
	there.conversation?.parent?.conversationId === id &&
		there.title === 'two (echo/echo@bob)' &&
		there.entries.length === 2,
	'the second thread is a fork at the question, named for its model, so the two sit side by side',
	JSON.stringify([there.conversation, there.title]),
)

// Asking again in the fork reaches its own agent, with what it said
await api('POST', `/api/threads/${fork}/entries`, { body: 'and 3+3?' })
const again = await answered(fork, 2)
const own = (await conversationOf(again, 'echo/echo@bob')).entries
const caughtUp = text(own.filter((e) => e.kind === 'agent-ide.delivery').at(-1)?.model[0])
check(
	answers(again).at(-1)?.data.author === 'echo/echo@bob' &&
		caughtUp === 'oskar: and 3+3?' &&
		!own.some((e) => e.kind === 'agent-ide.delivery' && text(e.model[0]).includes('ann thinks')),
	'the fork keeps asking its own agent, which never sees the other thread',
	caughtUp,
)

// Stop stops a thread's agent
await api('POST', `/api/threads/${id}/entries`, { body: 'once more' })
await until(async () => (await view(id)).agents.every((a) => a.status === 'working'), 8000, 20)
await api('POST', `/api/threads/${id}/stop`, {})
await sleep(500)
const stopped = await view(id)
check(
	stopped.agents.every((a) => a.status === 'idle') && stopped.status !== 'working',
	'stop stops the agent in the thread',
	JSON.stringify(stopped.agents),
)

/** Cy works through a tool call */
const cy = await scriptedRunner('cy', (request) => {
	const t = text(request.messages.findLast((m) => m.role === 'user'))
	if (t.includes('again')) return say('cy heard it all')
	if (request.messages.at(-1).role === 'user' && t.includes('work'))
		return call('bash', { command: 'sleep 1' })
	return say(`cy thinks ${'hmm '.repeat(300)}`)
})
const toCy = { runner: 'cy', model: 'echo/echo' }
const {
	json: { id: gap },
} = await api('POST', '/api/threads', { title: 'gap' })
const cyInputs = async () =>
	(await conversationOf(await view(gap), 'echo/echo@cy')).entries
		?.filter((e) => e.kind === 'agent-ide.delivery')
		.map((e) => text(e.model[0])) ?? []
await api('POST', `/api/threads/${gap}/entries`, { body: 'work', to: toCy })
await until(
	async () =>
		(await conversationOf(await view(gap), 'echo/echo@cy')).entries?.some(
			(e) => e.kind === 'pi.assistant',
		),
	8000,
	20,
)
await api('POST', `/api/threads/${gap}/entries`, { body: 'and a follow-up', to: toCy })
await api('POST', `/api/threads/${gap}/entries`, { body: 'steer now', to: toCy, steer: true })
const steered = await until(
	async () => (await cyInputs()).some((t) => t.includes('steer now')),
	8000,
	20,
)
await api('POST', `/api/threads/${gap}/stop`, {})
const before = await cyInputs()
check(
	Boolean(steered) && !before.some((t) => t.includes('follow-up')),
	'the steer was placed, the follow-up withdrawn',
	JSON.stringify(before),
)
await api('POST', `/api/threads/${gap}/entries`, { body: 'again', to: toCy })
await answered(gap, 1)
const last = (await cyInputs()).at(-1)
check(
	last === 'oskar: and a follow-up\n\noskar: again',
	'the next input carries the withdrawn follow-up',
	JSON.stringify(last),
)

ann.close()
bob.close()
cy.close()
done()
