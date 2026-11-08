/** MODULES=+director: a bot's answer that @mentions another bot here asks it, never itself or a bot not here, and bots rest after three answers in a row until a person writes */
import { answered, api, check, done, quiet, say, scriptedRunner, server, text, view } from './lib.js'

await server({ MODULES: '+bots,+director' })
/** Each bot passes the floor to the next, by @mention, and mentions itself and an outsider on the way */
const next = { Kira: 'ada', Ada: 'bram', Bram: 'kira' }
await scriptedRunner('laptop', (request) => {
	const name = /You are the bot (\w+)/.exec(JSON.stringify(request.messages))?.[1]
	const told = text(request.messages.at(-1))
	if (told.includes('quiet')) return say(`${name}: as @${name.toLowerCase()} I say, ask @cleo`)
	return say(`${name} here, over to @${next[name]}`)
})
for (const name of ['Kira', 'Ada', 'Bram'])
	await api('POST', '/api/bots', { name, to: 'echo/echo@laptop' })
await api('POST', '/api/bots', { name: 'Cleo', to: 'echo/echo@laptop' })
const authors = (v) => v.entries.filter((e) => e.data.answer).map((e) => e.data.author)

const room = (await api('POST', '/api/threads', { title: 'room' })).json.id
await api('POST', `/api/threads/${room}/entries`, { body: 'quiet please', to: ['Kira', 'Ada', 'Bram'] })
const hello = await answered(room, 3)
await quiet()
check(
	(await view(room)).entries.length === hello.entries.length &&
		hello.entries.slice(1).every((entry) => !entry.data.to),
	'an answer that @mentions only its own bot, or a bot not in the thread, asks no one',
	JSON.stringify(hello.entries.map((e) => e.data)),
)

await api('POST', `/api/threads/${room}/entries`, { body: '@kira start' })
const chain = await answered(room, 6)
await quiet()
const settled = await view(room)
check(
	JSON.stringify(authors(settled).slice(3)) === '["Kira","Ada","Bram"]',
	'each answer summons the bot it @mentions, until three bots have answered in a row',
	JSON.stringify(authors(settled)),
)
const answers = settled.entries.slice(-3)
check(
	JSON.stringify(answers.map((e) => e.data.to ?? null)) === '[["Ada"],["Bram"],null]',
	'the answer that summons says whom it asks; the third, resting, asks no one',
	JSON.stringify(answers.map((e) => e.data)),
)

await api('POST', `/api/threads/${room}/entries`, { body: 'and again', to: 'Bram' })
await answered(room, 9)
await quiet()
check(
	JSON.stringify(authors(await view(room)).slice(6)) === '["Bram","Kira","Ada"]',
	'a person writing wakes them: @mentions summon again, for three answers',
	JSON.stringify(authors(await view(room))),
)

for (const name of ['Kira', 'Ada', 'Bram', 'Cleo']) await api('DELETE', `/api/bots/${name}`)
done()
