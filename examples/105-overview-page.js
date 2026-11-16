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
		return say(
			`Page ${pages}: where it stands.\n\n## Working\n- Going on [#0](#message-0)\n\n## Done\n${Array.from({ length: 12 }, (_, at) => `- Thing ${at}`).join('\n')}`,
		)
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

await api('POST', `/api/threads/${id}/entries`, { body: 'Nobody looks', to: ['echo/echo@box'] })
await answered(id)
await until(async () => !(await api('GET', path)).json.writing)
check(pages === 0, 'a page nobody looks at is never written')

const opened = await api('GET', `${path}?open`)
check(opened.json.writing, 'opened, a page that is behind starts writing')
check(
	await until(async () => (await api('GET', path)).json.through === 2),
	'and catches up with the thread',
)
check(handed[0].includes('[0] oskar (person): Nobody looks'), 'from its messages, numbered from 0')

const first = (await api('GET', path)).json
check(
	first.summary === 'Page 1: where it stands.' && first.open === 1 && first.waiting === 0,
	'the page, its first line and its counts come back',
	JSON.stringify(first),
)
check(
	first.page.includes('- Thing 9') && !first.page.includes('- Thing 10'),
	'Done keeps its newest ten',
)

await api('POST', `/api/threads/${id}/entries`, { body: 'More, please', to: ['echo/echo@box'] })
await answered(id, 2)
check(
	await until(async () => (await api('GET', path)).json.through === 4),
	'while someone looks, the next answer rewrites it',
)
check(
	handed[1].includes('Page 1: where it stands.') &&
		handed[1].includes('[2] oskar (person): More, please') &&
		!handed[1].includes('Nobody looks'),
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

const fresh = (await api('POST', path, { fresh: true })).json
check(
	pages === asked + 1 && handed.at(-1).includes('no page yet') && fresh.through > 0,
	'fresh writes the page again from the messages alone',
)

await api('POST', path, { on: false })
await api('POST', `/api/threads/${id}/entries`, { body: 'Quiet now', to: ['echo/echo@box'] })
await answered(id, 4)
await until(async () => !(await api('GET', path)).json.writing)
check(
	(await api('GET', path)).json.on === false && pages === asked + 1,
	'switched off, answers write no page',
)
check((await api('POST', path, {})).status >= 400, 'and none on request')
done()
