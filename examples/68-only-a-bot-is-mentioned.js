/** MODULES=+director: an @mention asks a bot here, from a person or an agent's post; an agent written out is never a mention */
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
let garden
await scriptedRunner('laptop', (request) => {
	const last = request.messages.findLast((m) => m.role !== 'system')
	if (last.role === 'toolResult') return say('posted')
	if (text(last).includes('tell kira'))
		return call('post', { thread: garden, body: '@kira, the roses need you' })
	return say(`heard: ${text(last)}`)
})
const post = (id, body, to) =>
	api('POST', `/api/threads/${id}/entries`, { body, ...(to ? { to } : {}) })
const author = (v) => v?.entries.filter((e) => e.data.answer).at(-1)?.data.author

await api('POST', '/api/bots', { name: 'Kira', to: 'echo/echo@laptop' })
garden = (await api('POST', '/api/threads', { title: 'garden' })).json.id
await post(garden, 'hello', 'Kira')
await answered(garden)
await post(garden, 'what grows?', 'echo/echo@laptop')
await answered(garden, 2)

const written = await post(garden, '@echo/echo@laptop and in shade?', 'Kira')
check(
	JSON.stringify(written.json.to) === '["Kira"]',
	'an agent written out after @ is no mention: the message asks its own `to`',
	JSON.stringify(written.json),
)
await answered(garden, 3)

await post(garden, 'and in sun?', 'echo/echo@laptop')
await answered(garden, 4)
const shed = (await api('POST', '/api/threads', { title: 'shed' })).json.id
await post(shed, 'tell kira', 'echo/echo@laptop')
const told = await until(async () => {
	const v = await view(garden)
	return v.entries.find((e) => e.data.from === shed)
})
check(
	JSON.stringify(told?.data.to) === '["Kira"]',
	"an agent's post that @mentions a bot asks that bot, not whom the thread asked last",
	JSON.stringify(told?.data),
)

await api('DELETE', '/api/bots/Kira')
done()
