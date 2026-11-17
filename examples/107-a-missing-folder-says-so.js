/** An agent whose folder is gone doesn't run: the thread says the folder no longer exists, and asking it in another folder hands it what waited */
import { mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import {
	answered,
	api,
	call,
	check,
	dir,
	done,
	say,
	scriptedRunner,
	server,
	text,
	until,
	view,
} from './lib.js'

await server()
const heard = []
await scriptedRunner('desk', (request) => {
	const last = request.messages.findLast((m) => m.role !== 'system')
	if (last.role === 'toolResult') return say(`in ${text(last).trim()}`)
	heard.push(text(last))
	return call('bash', { command: 'pwd' })
})
const old = path.join(dir, 'agent-ide')
const renamed = path.join(dir, 'ade')
mkdirSync(old)
const id = (await api('POST', '/api/threads', { title: 'renamed' })).json.id
const post = (body, to) =>
	api('POST', `/api/threads/${id}/entries`, { body, ...(to ? { to } : {}) })

await post('where are you?', { runner: 'desk', model: 'echo/echo', dir: 'agent-ide' })
await answered(id)
renameSync(old, renamed)
const asked = heard.length

await post('and now?')
const said = await until(async () => {
	const v = await view(id)
	return v.entries.length > 3 && !['working', 'blocked'].includes(v.status) ? v : null
})
const line = said?.entries.at(-1)?.data
check(
	line?.error && line.body === `folder ${old} no longer exists`,
	'the thread says, in one line, that the folder no longer exists',
	JSON.stringify(said?.entries.map((e) => e.data)),
)
check(heard.length === asked, 'the agent never runs there', JSON.stringify(heard))

await post('here?', { runner: 'desk', model: 'echo/echo', dir: 'ade' })
const v = await answered(id, 2)
check(
	v.entries.at(-1).data.body === `in ${renamed}` &&
		heard.at(-1).includes('and now?') &&
		heard.at(-1).includes('here?'),
	'picking the folder it moved to runs it there, handed what waited too',
	JSON.stringify([v.entries.at(-1).data, heard.at(-1)]),
)
done()
