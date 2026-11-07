/** MODULES=+bots,+director: a bot that's in a thread speaks there as itself when it posts from home, and the room answers in the room */
import { answered, api, call, check, done, say, scriptedRunner, server, text, until, view } from './lib.js'

await server({ MODULES: '+bots,+director' })
await scriptedRunner('laptop', (request) => {
	const name = /You are the bot (\w+)/.exec(JSON.stringify(request.messages))?.[1]
	const last = request.messages.at(-1)
	if (last.role === 'toolResult') return say('')
	const told = text(last)
	const room = told.match(/tell room (\d+)/)?.[1]
	if (room) return call('post', { thread: Number(room), body: 'Hello room, @Kira what do you think?' })
	return say(`${name} heard: ${told.slice(-30)}`)
})
for (const name of ['Pm', 'Kira'])
	await api('POST', '/api/bots', { name, to: 'echo/echo@laptop' })
const home = (await api('GET', '/api/bots')).json.find((bot) => bot.name === 'Pm').home

const room = (await api('POST', '/api/threads', { title: 'room' })).json.id
await api('POST', `/api/threads/${room}/entries`, { body: 'hi both', to: ['Pm', 'Kira'] })
await answered(room, 2)

await api('POST', `/api/threads/${home}/entries`, { body: `tell room ${room}`, to: ['Pm'] })
const said = await until(async () =>
	(await view(room)).entries.find((entry) => entry.data.body?.startsWith('Hello room')),
)
check(
	said && said.data.author === 'Pm' && !said.data.from && JSON.stringify(said.data.to) === '["Kira"]',
	'a member bot posting into its room says it there as itself, not as a question from home',
	JSON.stringify(said?.data),
)
const after = await answered(room, 3)
await new Promise((resolve) => setTimeout(resolve, 300))
const backHome = (await view(home)).entries.filter((entry) => entry.data.from === room)
check(
	after.entries.at(-1).data.author === 'Kira' && backHome.length === 0,
	"the room's answer stays in the room; nothing comes back home",
	JSON.stringify(backHome.map((entry) => entry.data)),
)

await api('POST', `/api/threads/${room}/entries`, { body: '@Pm and you?' })
const reply = await answered(room, 4)
check(
	reply.entries.at(-1).data.author === 'Pm',
	'@mentioning the member bot in the room reaches its run there',
	JSON.stringify(reply.entries.at(-1).data),
)

for (const name of ['Pm', 'Kira']) await api('DELETE', `/api/bots/${name}`)
done()
