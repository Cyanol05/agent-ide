/** An agent's live work names the delivery it answers, the entry in its own conversation that handed it the thread's messages */
import { api, base, call, check, conversationOf, done, say, scriptedRunner, server, until, view } from './lib.js'

await server()
const bot = await scriptedRunner('bot', (request) =>
	request.messages.at(-1).role === 'toolResult' ? say('done') : call('bash', { command: 'sleep 1; echo slept' }),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'live' })

const heard = []
const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`)
socket.onmessage = ({ data }) => {
	const message = JSON.parse(data)
	if (message.thread === id && message.live) heard.push(message.live)
}
socket.onopen = () => socket.send(JSON.stringify({ watch: id }))

/** One message to the agent, and what the socket said while it worked on it */
async function ask(body) {
	const from = heard.length
	const {
		json: { entry },
	} = await api('POST', `/api/threads/${id}/entries`, { body, to: { runner: 'bot', model: 'echo/echo' } })
	await until(async () => (await view(id)).entries.at(-1)?.data.answer, 15000)
	await until(async () => !heard.at(-1)?.run)
	const v = await view(id)
	const deliveries = (await conversationOf(v, 'echo/echo@bot')).entries.filter((e) => e.kind === 'agent-ide.delivery')
	return { entry, delivery: deliveries.at(-1), lives: heard.slice(from) }
}

const first = await ask('work')
const working = first.lives.filter((live) => live.run)
check(
	working.length > 0 &&
		working.every((live) => live.delivery?.id === first.delivery?.id && live.delivery.held.includes(first.entry)),
	'while it works, every update names the delivery it answers and the messages it held',
	JSON.stringify(working.map((live) => live.delivery)),
)
check(
	first.lives.filter((live) => !live.run).every((live) => live.delivery === undefined),
	'an idle agent names no delivery',
)

const second = await ask('again')
check(
	second.delivery.id > first.delivery.id &&
		second.lives.filter((live) => live.run).every((live) => live.delivery?.id === second.delivery.id),
	'the next turn names its own delivery',
	JSON.stringify(second.lives.map((live) => live.delivery?.id)),
)
socket.close()
bot.close()
done()
