/** A post needs no title; both talk tools accept an id or an exact, unambiguous title. */
import {
	api,
	call,
	check,
	conversationOf,
	done,
	kill,
	say,
	scriptedRunner,
	server,
	text,
	until,
	view,
} from './lib.js'

let srv = await server({ MODULES: '-auto-title' })
let next
await scriptedRunner('talk', (request) => {
	if (
		request.messages.some(
			(message) => message.role === 'system' && message.content.includes('title generator'),
		)
	)
		return say('A polished side question')
	const last = request.messages.findLast((message) => message.role !== 'system')
	if (last.role === 'toolResult') return say(text(last))
	const pending = next
	next = undefined
	return pending ? call(pending.tool, pending.args) : say('answer')
})
const create = async (title) => (await api('POST', '/api/threads', { title })).json.id
const parent = await create('parent')
async function run(tool, args) {
	next = { tool, args }
	const before = (await conversationOf(await view(parent), 'echo/echo@talk'))?.entries?.length ?? 0
	await api('POST', `/api/threads/${parent}/entries`, {
		body: 'run the tool',
		to: { runner: 'talk', model: 'echo/echo' },
	})
	const result = await until(async () => {
		const conversation = await conversationOf(await view(parent), 'echo/echo@talk')
		return conversation.entries.slice(before).find((entry) => entry.kind === 'pi.tool-result')
	})
	check(Boolean(result), 'tool returned')
	await until(async () => (await view(parent)).status !== 'working')
	return text(result.model[0])
}
const body = 'A side question with no chosen title'
let result = await run('post', { body, to: 'nobody' })
check(
	result.includes('Posted to thread'),
	'post without title succeeds with auto-title off',
	result,
)
let rows = (await api('GET', '/api/threads')).json
const child = rows.find((row) => row.parent === parent)
check(child?.title === body, 'API shows the body-derived title, as the client does')
check((await run('threads', { thread: body })).includes(body), 'threads reads by title')
check((await run('threads', { thread: child.id })).includes(body), 'threads still reads by id')
check(
	(await run('post', { thread: body, body: 'more news', to: 'nobody' })).includes(
		`thread ${child.id}`,
	),
	'post writes by title',
)
check(
	(await run('threads', { thread: body, query: 'more news' })).includes('more news'),
	'query reads by title',
)
check(
	(await run('threads', { thread: 'parent', agent: 'agent' })).includes('called post'),
	'agent work reads by title',
)
check(
	(await run('threads', { thread: 'missing title' })).includes('No thread'),
	'missing title fails clearly',
)
const duplicate = await create(body)
await api('POST', `/api/threads/${duplicate}/archive`, { archived: true })
for (const tool of ['threads', 'post']) {
	result = await run(tool, {
		thread: body,
		...(tool === 'post' ? { body: 'must not write', to: 'nobody' } : {}),
	})
	check(
		result.includes('Several threads') &&
			result.includes(String(child.id)) &&
			result.includes(String(duplicate)),
		`${tool} lists ambiguous matching ids`,
		result,
	)
}
check(
	!(await view(child.id)).entries.some((entry) => entry.data.body === 'must not write'),
	'ambiguous post writes nothing',
)
check(
	(await run('threads', { thread: child.id })).includes(body),
	'id disambiguates duplicate titles',
)
await api('POST', `/api/threads/${duplicate}/title`, { title: 'Archived question' })
check(
	(
		await run('post', { thread: 'Archived question', body: 'archived news', to: 'nobody' })
	).includes(`thread ${duplicate}`),
	'post finds an archived thread by title',
)
check(
	(await run('threads', { thread: 'Archived question' })).includes('archived news'),
	'threads reads an archived thread by title',
)
await kill(srv)
srv = await server({ MODULES: '+auto-title' })
result = await run('post', { title: '  ', body: 'Blank titles use the same rule', to: 'nobody' })
check(result.includes('Posted to thread'), 'blank title succeeds with auto-title on', result)
rows = (await api('GET', '/api/threads')).json
check(
	rows.some((row) => row.title === 'Blank titles use the same rule'),
	'auto-title on uses the same initial title',
)
result = await run('post', { body: 'Polish this question after its answer', to: 'echo/echo@talk' })
check(
	result.includes('Posted to thread'),
	'untitled post to an agent succeeds on its first call',
	result,
)
check(
	await until(async () =>
		(await api('GET', '/api/threads')).json.some((row) => row.title === 'A polished side question'),
	),
	'auto-title polishes the body-derived title after an answer',
)
done()
