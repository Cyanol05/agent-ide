/** A fork keeps today's thread tools, an agent's history, and its own identity */
import {
	answered,
	answers,
	api,
	check,
	conversationOf,
	done,
	say,
	scriptedRunner,
	server,
	view,
} from './lib.js'

let srv = await server({ MODULES: 'talk' })
await scriptedRunner('bot', (request) => {
	const tools = new Set()
	const sections = {}
	for (const m of request.messages.filter((m) => m.role === 'system')) {
		for (const t of m.toolsAdded ?? []) tools.add(t.name)
		for (const t of m.toolsRemoved ?? []) tools.delete(t.name ?? t)
		Object.assign(sections, m.sections)
	}
	return say(JSON.stringify({ tools: [...tools].sort(), instructions: sections.instructions }))
})
const to = { runner: 'bot', model: 'echo/echo' }
const name = 'echo/echo@bot'
const id = (await api('POST', '/api/threads', { title: 'fork settings' })).json.id
await api('POST', `/api/threads/${id}/entries`, { body: 'which tools?', to })
const first = await answered(id)
const oldAnswer = answers(first)[0]
const original = await conversationOf(first, name)
const all = JSON.parse(oldAnswer.data.body).tools
const forks = []

// The issue's repro: restrict tools after an answer, then fork that older answer.
await api('POST', `/api/threads/${id}/tools`, { tools: ['read'] })
const read = (await api('POST', `/api/threads/${id}/fork`, { at: oldAnswer.id })).json.id
forks.push({ id: read, tools: ['read'], expected: ['read'], inherited: 1 })
// Before any answer, the asked agent is made afresh with the same thread policy.
const fresh = (await api('POST', `/api/threads/${id}/fork`, { at: first.entries[0].id })).json.id
forks.push({ id: fresh, tools: ['read'], expected: ['read'], inherited: 0 })

await api('POST', `/api/threads/${id}/entries`, { body: 'with just read' })
const restricted = await answered(id, 2)
const restrictedAnswer = answers(restricted).at(-1)
// Relative selections must replace the old selection too.
const relative = ['-bash', '-edit', '-write']
await api('POST', `/api/threads/${id}/tools`, { tools: relative })
const less = (await api('POST', `/api/threads/${id}/fork`, { at: oldAnswer.id })).json.id
forks.push({
	id: less,
	tools: relative,
	expected: all.filter((name) => !['bash', 'edit', 'write'].includes(name)),
	inherited: 1,
})
// Clearing the policy must not resurrect the historical read-only selection.
await api('POST', `/api/threads/${id}/tools`, { tools: null })
const full = (await api('POST', `/api/threads/${id}/fork`, { at: restrictedAnswer.id })).json.id
forks.push({ id: full, tools: null, expected: all, inherited: 2 })
const source = await conversationOf(await view(id), name)

// Fork settings and identity are stored in the same commit, not repaired at delivery.
const exited = new Promise((resolve) => srv.once('exit', resolve))
srv.kill('SIGKILL')
await exited
srv = await server({ MODULES: 'talk' })
for (const fork of forks) {
	let v = await view(fork.id)
	const own = await conversationOf(v, name)
	check(
		JSON.stringify(v.tools) === JSON.stringify(fork.tools) &&
			own.docs['pi.agent'].instructions.includes(`You are thread ${fork.id}'s agent,`),
		`fork ${fork.id} stores its shown tools and its own identity across restart`,
		JSON.stringify({ tools: v.tools, agent: own.docs['pi.agent'] }),
	)
	check(
		['model', 'thinkingLevel', 'cwd'].every(
			(key) =>
				JSON.stringify(own.docs['pi.agent'][key]) ===
				JSON.stringify(original.docs['pi.agent'][key]),
		),
		`fork ${fork.id} keeps the same agent's model, thinking and folder`,
	)
	// A thread's number alone reaches its agent
	await api('POST', `/api/threads/${fork.id}/entries`, {
		body: 'which tools now?',
		to: String(fork.id),
	})
	v = await answered(fork.id, fork.inherited + 1)
	const received = JSON.parse(answers(v).at(-1).data.body)
	check(
		JSON.stringify(received.tools) === JSON.stringify(fork.expected),
		`fork ${fork.id} offers exactly the tools its policy shows`,
		JSON.stringify(received.tools),
	)
	check(
		received.instructions.includes(`You are thread ${fork.id}'s agent,`) &&
			!received.instructions.includes(`thread ${id}'s`) &&
			received.instructions.includes('only some tools') === Boolean(fork.tools),
		`fork ${fork.id} tells the model its new thread and tool policy`,
		received.instructions,
	)
}
check(
	JSON.stringify((await conversationOf(await view(id), name)).docs['pi.agent']) ===
		JSON.stringify(source.docs['pi.agent']) && answers(await view(id)).length === 2,
	'forking leaves the source agent and answers unchanged',
)

done()
