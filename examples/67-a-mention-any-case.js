/** MODULES=+director: a name is written as it reads, and typed in any case */
import { answered, api, check, done, say, scriptedRunner, server, text } from './lib.js'

await server({ MODULES: '+bots,+director' })
await scriptedRunner('laptop', (request) => {
	const last = request.messages.findLast((m) => m.role !== 'system')
	return say(`${last.role}: ${text(last)}`)
})
const post = (id, body, to) => api('POST', `/api/threads/${id}/entries`, { body, to })
const author = (v) => v?.entries.filter((e) => e.data.answer).at(-1)?.data.author

await api('POST', '/api/bots', { name: 'Kira', to: 'echo/echo@laptop' })
const thread = (await api('POST', '/api/threads', { title: 'garden' })).json.id
await post(thread, 'what grows?', 'echo/echo@laptop')
await answered(thread)
await post(thread, 'hello', 'Kira')
await answered(thread, 2)
await post(thread, 'and in sun?', 'echo/echo@laptop')
const asked = await answered(thread, 3)

await post(thread, '@kira: and in shade?')
let v = await answered(thread, 4)
check(
	author(asked) === 'echo/echo@laptop' && author(v) === 'Kira',
	'@kira, in the case the person typed, asks Kira, whoever the thread asked last',
	JSON.stringify(v?.entries.at(-1)?.data),
)

await post(thread, '@nobody: still here?')
v = await answered(thread, 5)
check(
	author(v) === 'Kira' && !v?.entries.at(-1)?.data.error,
	'a mention of no one leaves the thread asking whom it asked last',
	JSON.stringify(v?.entries.at(-1)?.data),
)

await api('DELETE', '/api/bots/Kira')
done()
