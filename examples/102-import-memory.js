/** Recorded memory can be loaded without a runner; imports never replace lines already written. */
import { api, check, done, server } from './lib.js'
await server({ MODULES: '+memory,-director' })
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Recorded memory' })
for (const body of ['First message', 'Second message'])
	await api('POST', `/api/threads/${id}/entries`, { body, to: null })
const path = `/api/threads/${id}/memory`
const lines = [
	{ id: 0, n: 1, text: 'oskar: First message' },
	{ id: 1, n: 1, text: 'oskar: Second message' },
	{ id: 0, n: 2, text: 'oskar: Two messages' },
]
const imported = await api('POST', path, { lines })
check(
	imported.status === 201 && imported.json.memory === true,
	'import enables memory without a model',
)
check(
	JSON.stringify((await api('GET', path + '?budget=1')).json.lines) === JSON.stringify([lines[2]]),
	'imported pairs render as memory',
)
await api('POST', path, { lines: [{ id: 0, n: 2, text: 'replacement' }] })
check(
	(await api('GET', path + '?budget=1')).json.lines[0]?.text === lines[2].text,
	'a repeated import leaves existing lines alone',
)
for (const line of [
	{ id: 2, n: 1 },
	{ id: 0, n: 4 },
	{ id: 1, n: 2 },
	{ id: 0, n: 3 },
	{ id: -1, n: 1 },
])
	check(
		(await api('POST', path, { lines: [{ ...line, text: 'outside' }] })).status >= 400,
		`rejects invalid span ${line.id}+${line.n}`,
	)
check(
	(await api('GET', path + '?zoom=0,2')).json.lines.length === 2,
	'zoom opens imported children',
)
done()
