/** MODULES=+director with DIRECTOR_MODEL: a person's message that names no one, in a thread of bots, asks whom a model picks, or nobody */
import {
	answered,
	answers,
	api,
	check,
	done,
	say,
	scriptedRunner,
	server,
	text,
	view,
} from './lib.js'

await server({ MODULES: '+bots,+director', DIRECTOR_MODEL: 'echo/echo@laptop' })
const asked = []
await scriptedRunner('laptop', (request) => {
	const system = request.messages.find((m) => m.role === 'system')
	const last = request.messages.findLast((m) => m.role !== 'system')
	if (text(system ?? { content: '' }).includes('You choose who answers')) {
		const ask = text(last)
		asked.push(ask)
		const message = ask.match(/New message: \[[^\]]+\] (.*)/)?.[1] ?? ''
		if (message.includes('roses')) return say('Kira: she knows roses')
		if (message.includes('thanks')) return say('nobody: they have what they need')
		return say('Bob: no idea')
	}
	return say(`heard: ${text(last)}`)
})
const post = (id, body, to) =>
	api('POST', `/api/threads/${id}/entries`, { body, ...(to !== undefined ? { to } : {}) })
const last = async (id) => (await view(id)).entries.at(-1)

await api('POST', '/api/bots', {
	name: 'Kira',
	to: 'echo/echo@laptop',
	instructions: 'A gardener.',
})
await api('POST', '/api/bots', { name: 'Ada', to: 'echo/echo@laptop' })
const solo = (await api('POST', '/api/threads', { title: 'solo' })).json.id
await post(solo, 'hello', 'Kira')
await answered(solo)
await post(solo, 'and the roses?')
check(
	JSON.stringify((await last(solo)).data.to) === '["Kira"]' && !asked.length,
	'with one bot here, a message naming no one asks whom the thread asked last, without asking the director',
	JSON.stringify((await last(solo)).data),
)

const garden = (await api('POST', '/api/threads', { title: 'garden' })).json.id
await post(garden, 'hello', ['Kira', 'Ada'])
await answered(garden, 2)
const before = asked.length
await post(garden, 'what about the roses?')
const picked = await last(garden)
check(
	JSON.stringify(picked.data.to) === '["Kira"]' && picked.data.picked === 'she knows roses',
	'in a thread of bots, the director picks one, and the message keeps why',
	JSON.stringify(picked.data),
)
check(
	asked[before]?.includes('- Kira: A gardener.') &&
		asked[before]?.includes('- Ada: no persona; a generalist'),
	'the director reads each bot here with its instructions',
	asked[before],
)
await answered(garden, 3)
check(answers(await view(garden)).at(-1)?.data.author === 'Kira', 'the bot it picked answers')

await post(garden, 'thanks!')
const quiet = await last(garden)
check(
	!quiet.data.to && quiet.data.picked === 'they have what they need',
	'it can pick nobody, and then no one is asked',
	JSON.stringify(quiet.data),
)

await post(garden, 'who knows?')
const unknown = await last(garden)
check(
	JSON.stringify(unknown.data.to) === '["Kira"]' && !unknown.data.picked,
	"a name that isn't here falls back to whom the thread asked last",
	JSON.stringify(unknown.data),
)
await answered(garden, 4)

const count = asked.length
await post(garden, '@ada, and the roses?')
check(
	JSON.stringify((await last(garden)).data.to) === '["Ada"]' && asked.length === count,
	'an @mention comes first: no pick',
)
await answered(garden, 5)
await post(garden, '@bob, the roses?', 'Ada')
const thread = (await api('GET', `/api/threads/${garden}`)).json
check(
	!JSON.stringify(thread).includes('"bob"') &&
		JSON.stringify((await last(garden)).data.to) === '["Ada"]',
	"an @mention of someone who isn't here brings no one in",
)
await answered(garden, 6)
await post(garden, 'roses again', 'Ada')
check(
	JSON.stringify((await last(garden)).data.to) === '["Ada"]' && asked.length === count,
	'a message with its own `to` asks that, no pick',
)
await answered(garden, 7)

await api('DELETE', '/api/bots/Kira')
await api('DELETE', '/api/bots/Ada')
done()
