/** While an agent works, the socket sends each entry its conversation gets, as written: its thinking and a tool's output show before the turn ends */
import {
	fauxThinking,
	fauxToolCall,
	fauxAssistantMessage,
} from '@earendil-works/pi-ai/providers/faux'
import { api, base, check, done, say, scriptedRunner, server, until } from './lib.js'

await server()
const bot = await scriptedRunner('bot', (request) =>
	request.messages.at(-1).role === 'toolResult'
		? say('done')
		: fauxAssistantMessage(
				[
					fauxThinking('first the folder'),
					fauxToolCall('bash', { command: 'echo listed; sleep 3' }),
				],
				{
					stopReason: 'toolUse',
				},
			),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'live entries' })

const heard = []
let working = false
const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`)
socket.onmessage = ({ data }) => {
	const message = JSON.parse(data)
	if (message.thread !== id) return
	if (message.live) working = message.live.run
	if (message.agent && message.entries)
		heard.push(...message.entries.map((entry) => ({ entry, working })))
}
await new Promise((resolve) => (socket.onopen = resolve))
socket.send(JSON.stringify({ watch: id }))

await api('POST', `/api/threads/${id}/entries`, {
	body: 'look',
	to: { runner: 'bot', model: 'echo/echo' },
})
await until(
	async () => heard.some(({ entry }) => entry.model?.[0]?.content?.[0]?.text === 'done'),
	20000,
)

const thought = heard.find(({ entry }) =>
	entry.model?.[0]?.content?.some?.((block) => block.type === 'thinking'),
)
const output = heard.find(({ entry }) => entry.model?.[0]?.role === 'toolResult')
check(thought?.working, 'its thinking arrives while it still works', JSON.stringify(thought))
check(
	output?.working && /listed/.test(JSON.stringify(output.entry.model)),
	"the tool's output arrives before the turn ends",
)
const ids = heard.map(({ entry }) => entry.id)
check(new Set(ids).size === ids.length, 'each entry comes once', JSON.stringify(ids))
check(
	heard.some(({ entry }) => entry.kind === 'agent-ide.delivery'),
	'the delivery that started the turn comes too, so the client can place it',
)
socket.close()
bot.close()
done()
