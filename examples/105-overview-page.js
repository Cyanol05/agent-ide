/** A thread's overview is a recap, rewritten after each answer from the recap before and the messages since; agents can read it. */
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
		// The first try lists what's done; told that's not the shape, it writes the recap alone
		if (pages === 1) return say('Page 1: where it stands.\n\n## Done\n- Thing 0')
		return say(`Page ${pages}: where it stands. ${'And more. '.repeat(120)}`)
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
check(before.page === '' && before.through === 0, 'a new thread has an empty page')

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
	pages === 2 && first.page.startsWith('Page 2: where it stands.') && !first.page.includes('##'),
	'a page with sections is sent back once, and the recap alone is kept',
	JSON.stringify(first),
)
check(
	first.page.length <= 1024 && first.page.endsWith('And more.'),
	'a long recap is cut at a sentence',
)

await api('POST', `/api/threads/${id}/entries`, { body: 'More, please', to: ['echo/echo@box'] })
await answered(id, 2)
check(
	await until(async () => (await api('GET', path)).json.through === 4),
	'while someone looks, the next answer rewrites it',
)
check(
	handed[2].includes('Page 2: where it stands.') &&
		handed[2].includes('[2] oskar (person): More, please') &&
		!handed[2].includes('Nobody looks'),
	'a rewrite reads the page before and only the messages since',
	handed[2],
)

await api('POST', `/api/threads/${id}/entries`, {
	body: 'read your overview',
	to: ['echo/echo@box'],
})
await answered(id, 3)
check(
	(await api('GET', `/api/threads/${id}`)).json.entries
		.at(-1)
		.data.body.startsWith('I read: Page 3'),
	'the agent reads its page with the overview tool',
)
await until(async () => !(await api('GET', path)).json.writing)

const asked = pages
const now = await api('POST', path, {})
check(now.status === 201 && pages === asked, 'asking with nothing new spends no completion')

const fresh = (await api('POST', path, { fresh: true })).json
check(
	pages === asked + 1 && handed.at(-1).includes('no recap yet') && fresh.through > 0,
	'fresh writes the page again from the messages alone',
)

done()
