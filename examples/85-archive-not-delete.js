/** Archiving a thread only hides it; it's found and brought back, never erased. DELETE is gone, not an alias. */
import { api, check, done, server } from './lib.js'

await server({ RUNNER: '0' })
const { id } = (await api('POST', '/api/threads', { title: 'a thread' })).json

check(
	(await api('DELETE', `/api/threads/${id}`)).status === 404,
	'DELETE /api/threads/:id is gone, not kept as an alias for archive',
)

const list = async () => (await api('GET', '/api/threads')).json
const archivedList = async () => (await api('GET', '/api/threads/archived')).json

check(
	(await list()).some((t) => t.id === id && t.archived === false),
	'a fresh thread is not archived',
)

const archived = await api('POST', `/api/threads/${id}/archive`, { archived: true })
check(archived.status < 300 && archived.json.archived === true, 'archiving says so back')
check(
	!(await list()).some((t) => t.id === id) && (await archivedList()).some((t) => t.id === id),
	'archived, it leaves the main list for the archived one, title and all still there',
)

const view = (await api('GET', `/api/threads/${id}`)).json
check(view.archived === true && view.entries, 'archived, the thread itself still opens, nothing erased')

const back = await api('POST', `/api/threads/${id}/archive`, { archived: false })
check(back.status < 300 && back.json.archived === false, 'unarchiving says so back')
check(
	(await list()).some((t) => t.id === id) && !(await archivedList()).some((t) => t.id === id),
	'unarchived, it is back on the main list',
)
done()
