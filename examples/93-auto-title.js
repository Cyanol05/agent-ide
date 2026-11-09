/** A default title is polished once after the first answer; chosen titles stay put until a new one is asked for. */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { api, answered, check, db, done, say, scriptedRunner, server, until, view } from './lib.js'

writeFileSync(
	path.join(path.dirname(db), 'agent-ide.json'),
	JSON.stringify({
		modules: ['auto-title'],
	}),
)
const srv = await server()
check(srv.exitCode === null, 'auto-title loads as a module')
let titles = 0
let release
let mode = 'normal'
await scriptedRunner('title', async (request) => {
	if (
		request.messages.some(
			(message) => message.role === 'system' && message.content.includes('title generator'),
		)
	) {
		titles++
		if (mode === 'hold')
			await new Promise((resolve) => {
				release = resolve
			})
		if (mode === 'empty') return say('')
		return say('Title: "Fix production 500 errors."')
	}
	return say('An answer')
})
const body = 'please can you fix production 500 errors for me'
const create = async (title) => (await api('POST', '/api/threads', { title })).json.id
const post = async (id, message = body) => {
	const result = await api('POST', `/api/threads/${id}/entries`, {
		body: message,
		to: ['echo/echo@title'],
	})
	check(result.status === 201, 'message reaches the thread', JSON.stringify(result.json))
}
const idle = () =>
	until(async () => (await api('GET', '/api/runners')).json.every((runner) => !runner.calls.length))
const id = await create(body.slice(0, 60))
await post(id)
await answered(id)
check(
	await until(async () => (await view(id)).title === 'Fix production 500 errors'),
	'first answer polishes the default title',
)
await post(id)
await answered(id, 2)
await idle()
check(titles === 1, 'best-effort: later answers do not generate another title')
const explicit = await create('My chosen title')
await post(explicit)
await answered(explicit)
await idle()
check(
	(await view(explicit)).title === 'My chosen title' && titles === 1,
	'best-effort: an explicit title stays untouched',
)
const spacedBody = `${'x'.repeat(59)} more words`
const spaced = await create(spacedBody.slice(0, 60))
await post(spaced, spacedBody)
check(
	await until(async () => (await view(spaced)).title === 'Fix production 500 errors'),
	'default titles match after the API trims trailing whitespace',
)
mode = 'hold'
const edited = await create(body.slice(0, 60))
await post(edited)
check(await until(async () => release), 'title completion is in flight')
await api('POST', `/api/threads/${edited}/title`, { title: 'Keep this name' })
release()
await idle()
check(
	(await view(edited)).title === 'Keep this name',
	'best-effort: a manual edit during generation wins',
)
mode = 'empty'
const failed = await create(body.slice(0, 60))
await post(failed)
check(
	await until(async () =>
		readFileSync(db.replace(/\.sqlite$/, '.log'), 'utf8').includes(
			'model returned no usable title',
		),
	),
	'an unusable title is logged',
)
const tried = titles
await post(failed)
await answered(failed, 2)
await idle()
check(
	(await view(failed)).title === body.slice(0, 60) && titles === tried,
	'best-effort: a failed title is left alone and never retried',
)
mode = 'again'
const again = await create('My chosen title')
await post(again)
await answered(again)
const asked = await api('POST', `/api/threads/${again}/auto-title`, {})
check(
	asked.status === 201 && asked.json.title === 'Fix production 500 errors',
	'asked again, the answer waits for the new title',
	JSON.stringify(asked.json),
)
check(
	(await view(again)).title === 'Fix production 500 errors',
	'asked again, even a chosen title is replaced',
)
mode = 'hold'
release = undefined
const renaming = api('POST', `/api/threads/${again}/auto-title`, {})
check(await until(async () => release), 'the new title is in flight')
await api('POST', `/api/threads/${again}/title`, { title: 'Renamed meanwhile' })
release()
const renamed = await renaming
check(
	renamed.status === 201 && renamed.json.title === 'Renamed meanwhile',
	'a rename while it writes wins, and the answer says so',
	JSON.stringify(renamed.json),
)
check((await view(again)).title === 'Renamed meanwhile', 'the rename stays')
mode = 'empty'
const refused = await api('POST', `/api/threads/${again}/auto-title`, {})
check(
	refused.status === 400 && refused.json.error === 'model returned no usable title',
	'a failed new title answers with why',
	JSON.stringify(refused.json),
)
const unanswered = await create('Nobody here yet')
check(
	(await api('POST', `/api/threads/${unanswered}/auto-title`, {})).status >= 400,
	'a thread nobody has answered has no model to ask',
)
done()
