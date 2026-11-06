/** A thread can be renamed; an empty title is refused and the old one stays */
import { api, check, done, server } from './lib.js'

await server({ RUNNER: '0' })
const { id } = (await api('POST', '/api/threads', { title: 'first try' })).json
check(
	(await api('POST', `/api/threads/${id}/title`, { title: 'Favorite color' })).status < 300,
	'renaming works',
)
const title = async () => (await api('GET', '/api/threads')).json.find((t) => t.id === id)?.title
check((await title()) === 'Favorite color', 'the list shows the new title')
check(
	(await api('POST', `/api/threads/${id}/title`, { title: ' ' })).status >= 400,
	'an empty title is refused',
)
check((await title()) === 'Favorite color', 'and the old one stays')
done()
