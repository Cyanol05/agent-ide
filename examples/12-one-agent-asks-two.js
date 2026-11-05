/** A thread has one agent: to hear from two, it asks them, and two child threads answer side by side */
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
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
const ann = await scriptedRunner('ann', () => say(`ann here ${'hmm '.repeat(150)}`))
const bob = await scriptedRunner('bob', () => say('bob here'))
const toAnn = { runner: 'ann', model: 'echo/echo' }
const toBob = { runner: 'bob', model: 'echo/echo' }
/** The desk agent asks both in one turn, ends with nothing while it waits, and answers once both have */
const desk = await scriptedRunner('desk', (request) => {
	const last = request.messages.findLast((m) => m.role !== 'system')
	if (last.role === 'user' && text(last).includes('ask both'))
		return fauxAssistantMessage(
			[
				fauxToolCall('post', { to: 'echo/echo@ann', title: 'ann', body: 'which machine?' }),
				fauxToolCall('post', { to: 'echo/echo@bob', title: 'bob', body: 'which machine?' }),
			],
			{ stopReason: 'toolUse' },
		)
	const heard = JSON.stringify(request.messages)
	return say(heard.includes('ann here') && heard.includes('bob here') ? 'ann and bob both answered' : '')
})

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'two' })
const refused = await api('POST', `/api/threads/${id}/entries`, { body: 'both?', to: [toAnn, toBob] })
check(
	refused.status === 400 && /one agent/.test(refused.json.error) && !(await view(id)).entries.length,
	'two models in one message are refused: a thread has one agent',
	JSON.stringify(refused.json),
)

await api('POST', `/api/threads/${id}/entries`, {
	body: 'ask both which machine they are on',
	to: { runner: 'desk', model: 'echo/echo' },
})
const v = await answered(id, 1, 15000)
const children = (await api('GET', '/api/threads')).json.filter((t) => t.parent === id)
check(
	children.length === 2 &&
		children.every((t) => t.agents.length === 1) &&
		children.map((t) => t.agents[0].name).sort().join() === 'echo/echo@ann,echo/echo@bob',
	'the agent posts two child threads, one agent in each, side by side as its family',
	JSON.stringify(children.map((t) => [t.id, t.title, t.agents.map((a) => a.name)])),
)
check(
	answers(v).length === 1 && answers(v)[0].data.body === 'ann and bob both answered',
	'their answers come back to it, and it answers once, with both',
	brief(v),
)

// Stop stops a thread's agent
const slow = (await api('POST', '/api/threads', { title: 'slow' })).json.id
await api('POST', `/api/threads/${slow}/entries`, { body: 'think', to: toAnn })
await until(async () => (await view(slow)).agents.every((a) => a.status === 'working'), 8000, 20)
await api('POST', `/api/threads/${slow}/stop`, {})
await sleep(500)
const stopped = await view(slow)
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
desk.close()
cy.close()
done()
