/** A thread has one agent: to hear from two, it asks them, and two child threads answer side by side */
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import {
	answered,
	answers,
	api,
	brief,
	check,
	done,
	say,
	scriptedRunner,
	server,
	text,
	view,
} from './lib.js'

await server()
const ann = await scriptedRunner('ann', () => say('ann here'))
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
		children.map((t) => t.agents[0].name).sort().join() === 'echo@ann,echo@bob',
	'the agent posts two child threads, one agent in each, side by side as its family',
	JSON.stringify(children.map((t) => [t.id, t.title, t.agents.map((a) => a.name)])),
)
check(
	answers(v).length === 1 && answers(v)[0].data.body === 'ann and bob both answered',
	'their answers come back to it, and it answers once, with both',
	brief(v),
)

ann.close()
bob.close()
desk.close()
done()
