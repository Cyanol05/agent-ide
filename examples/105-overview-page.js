/** A thread's overview page is rewritten after each answer from the page before and the messages since, and agents can read it. */
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
} from './lib.js'

await server({ MODULES: '+overview,-auto-title,-director' })
const handed = []
let pages = 0
await scriptedRunner('box', (request) => {
	const system = text(request.messages[0] ?? { content: '' })
	if (system.startsWith('# Overview')) {
		handed.push(text(request.messages.at(-1)))
		pages++
		return say(`Page ${pages}: where it stands.\n\n## ⏳ Work\n\nGoing on [#0](#message-0).`)
	}
	const latest = request.messages.at(-1)
	if (latest.role === 'user' && text(latest).includes('read your overview'))
		return call('overview', {})
	if (latest.role === 'toolResult') return say(`I read: ${text(latest).split('\n', 1)[0]}`)
	return say('An answer')
})
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'Overview' })
const path = `/api/threads/${id}/overview`
const before = (await api('GET', path)).json
check(
	before.on === true && before.page === '' && before.through === 0,
	'a new thread has an empty page, on',
)

await api('POST', `/api/threads/${id}/entries`, { body: 'Start the work', to: ['echo/echo@box'] })
await answered(id)
check(
	await until(async () => (await api('GET', path)).json.through === 2),
	'the first answer writes the page',
)
const first = (await api('GET', path)).json
check(
	first.summary === 'Page 1: where it stands.' && first.page.includes('## ⏳ Work'),
	'the page and its first line come back',
	JSON.stringify(first),
)
check(
	handed[0].includes('[0] oskar (person): Start the work') && handed[0].includes('no page yet'),
	'the first page is written from the messages, numbered from 0',
)

await api('POST', `/api/threads/${id}/entries`, { body: 'More, please', to: ['echo/echo@box'] })
await answered(id, 2)
check(
	await until(async () => (await api('GET', path)).json.through === 4),
	'the next answer rewrites it',
)
check(
	handed[1].includes('Page 1: where it stands.') &&
		handed[1].includes('[2] oskar (person): More, please') &&
		!handed[1].includes('Start the work'),
	'a rewrite reads the page before and only the messages since',
	handed[1],
)

const summaries = (await api('GET', '/api/overview')).json
check(
	summaries[id]?.summary === 'Page 2: where it stands.' &&
		summaries[id].open === 1 &&
		summaries[id].waiting === 0,
	'each thread’s first line and open topics, by id',
	JSON.stringify(summaries),
)

await api('POST', `/api/threads/${id}/entries`, {
	body: 'read your overview',
	to: ['echo/echo@box'],
})
await answered(id, 3)
check(
	(await api('GET', `/api/threads/${id}`)).json.entries
		.at(-1)
		.data.body.startsWith('I read: Page 2'),
	'the agent reads its page with the overview tool',
)
await until(async () => !(await api('GET', path)).json.writing)

const asked = pages
const now = await api('POST', path, {})
check(now.status === 201 && pages === asked, 'asking with nothing new spends no completion')

await api('POST', path, { on: false })
await api('POST', `/api/threads/${id}/entries`, { body: 'Quiet now', to: ['echo/echo@box'] })
await answered(id, 4)
await until(async () => !(await api('GET', path)).json.writing)
check(
	(await api('GET', path)).json.on === false && pages === asked,
	'switched off, answers write no page',
)
check((await api('POST', path, {})).status >= 400, 'and none on request')
done()
