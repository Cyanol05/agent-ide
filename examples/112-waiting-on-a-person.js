/** Only an explicitly marked question blocks a thread; another agent turn and a restart keep it, any person's message clears it. */
import {
	api,
	call,
	check,
	done,
	kill,
	say,
	scriptedRunner,
	server,
	settled,
	text,
	until,
	view,
} from './lib.js'

const env = { MODULES: '+blocked,-auto-title,-director' }
let child = await server(env)
await scriptedRunner('desk', (request) => {
	const last = request.messages.at(-1)
	if (last.role === 'toolResult') return say('I will wait.')
	return text(last).includes('ask me')
		? call('ask_person', { body: 'Which account should I use?' })
		: say('Another agent answer.')
})
const id = (await api('POST', '/api/threads', { title: 'Needs a person' })).json.id
const post = (body, to) => api('POST', `/api/threads/${id}/entries`, { body, to })
await post('ask me', ['echo/echo@desk'])
await until(async () => (await view(id)).entries.some(({ data }) => data.body === 'I will wait.'))
await settled(id, { blocked: true })
const first = await view(id)
check(
	first.entries.some(
		({ data }) => data.body === 'Which account should I use?' && data.waitingOnPerson === true,
	),
	'the tool posts a marked question',
)
check(first.status === 'blocked', 'mark → blocked, despite the agent’s later answer')
check(
	(await api('GET', '/api/threads')).json.find((row) => row.id === id).status === 'blocked',
	'the sidebar list agrees',
)

// A child agent's post is not a person's reply, even though it asks the thread agent again.
const other = (await api('POST', '/api/threads', { title: 'Colleague' })).json.id
await scriptedRunner('colleague', (request) =>
	request.messages.at(-1).role === 'toolResult'
		? say('Posted.')
		: call('post', { thread: id, body: 'An agent follows up.', to: 'desk' }),
)
await api('POST', `/api/threads/${other}/entries`, {
	body: 'follow up',
	to: ['echo/echo@colleague'],
})
await until(async () =>
	(await view(id)).entries.some(({ data }) => data.body === 'Another agent answer.'),
)
await settled(id, { blocked: true })
check(
	(await view(id)).status === 'blocked',
	'an agent’s own later turn and another agent’s post do not clear it',
)

await kill(child, 'SIGKILL')
child = await server(env)
check((await view(id)).status === 'blocked', 'a hard restart keeps the outstanding question')
await api('POST', `/api/threads/${id}/read`, {})
check((await view(id)).status === 'blocked', 'reading does not clear it')
await post('Use the personal account.', [])
check(
	(await view(id)).status !== 'blocked',
	'a person’s next message clears it, even without asking an agent',
)
await post('Which account should I use?', [])
check((await view(id)).status !== 'blocked', 'question wording alone never blocks')
done()
