/** MODULES=+bots,+director: a bot that starts a thread is in it, speaks there as itself, and asks the bots its first message names, by `to` or @mention */
import {
	answered,
	api,
	call,
	check,
	done,
	say,
	scriptedRunner,
	server,
	text,
	until,
	view,
} from './lib.js'

await server({ MODULES: '+bots,+director' })
await scriptedRunner('laptop', (request) => {
	const name = /You are the bot (\w+)/.exec(JSON.stringify(request.messages))?.[1]
	const last = request.messages.at(-1)
	if (last.role === 'toolResult') return say('')
	const told = text(last)
	if (told.includes('start a room'))
		return call('post', { title: 'dinner', to: 'Vera', body: 'Vera, @pm: where do we eat?' })
	return say(`${name} heard: ${told.slice(-30)}`)
})
for (const name of ['Kira', 'Vera', 'PM'])
	await api('POST', '/api/bots', { name, to: 'echo/echo@laptop' })
const home = (await api('GET', '/api/bots')).json.find((bot) => bot.name === 'Kira').home

await api('POST', `/api/threads/${home}/entries`, { body: 'start a room', to: ['Kira'] })
const room = await until(async () =>
	(await api('GET', '/api/threads')).json.find((thread) => thread.title === 'dinner'),
)
const opened = await answered(room.id, 2)
const first = opened.entries[0].data
check(
	first.author === 'Kira' && !first.from && JSON.stringify(first.to) === '["Vera","PM"]',
	"a bot's opening post says it in the room as itself and asks both the bot it names and the one it @mentions",
	JSON.stringify(first),
)
check(
	JSON.stringify(opened.agents.map((agent) => agent.name).sort()) === '["Kira","PM","Vera"]',
	'the bot that started the room is in it, with those it asked',
	JSON.stringify(opened.agents.map((agent) => agent.name)),
)
await new Promise((resolve) => setTimeout(resolve, 300))
check(
	(await view(home)).entries.every((entry) => entry.data.from !== room.id),
	'their answers stay in the room; nothing comes back to her home',
	JSON.stringify((await view(home)).entries.map((entry) => entry.data)),
)

await api('POST', `/api/threads/${room.id}/entries`, { body: '@kira your pick?' })
const reply = await answered(room.id, 3)
check(
	reply.entries.at(-1).data.author === 'Kira',
	'@mentioning her in the room reaches her run there',
	JSON.stringify(reply.entries.at(-1).data),
)

for (const name of ['Kira', 'Vera', 'PM']) await api('DELETE', `/api/bots/${name}`)
done()
