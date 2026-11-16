/** The skills a runner's folder has, listed for the composer; a message starting `/skill:name` reaches the agent as pi expands it */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runner as context } from '../modules/context.js'
import { answered, api, check, dir, done, home, say, scriptedRunner, server, text } from './lib.js'

process.env.HOME = home
const skill = path.join(dir, '.agents/skills/greet/SKILL.md')
mkdirSync(path.dirname(skill), { recursive: true })
writeFileSync(skill, '---\nname: greet\ndescription: Greet someone warmly.\n---\nSay bonjour.')

/** The agent answers with the newest message it was handed, word for word */
const route = (request) => say(text(request.messages.findLast((m) => m.role === 'user')))
const listed = context({ name: 'bot', dir, roots: [dir] })
await server()
await scriptedRunner('bot', route, { ops: { context: listed.call }, readable: listed.readable })

const found = await api('GET', '/api/context?runner=bot')
check(
	found.json.skills?.some(
		(skill) => skill.name === 'greet' && skill.description === 'Greet someone warmly.',
	),
	'the runner lists the skills in its folder',
	JSON.stringify(found.json),
)

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'skills' })
const ask = async (body, n) => {
	await api('POST', `/api/threads/${id}/entries`, {
		body,
		to: { runner: 'bot', model: 'echo/echo' },
	})
	return (await answered(id, n))?.entries.at(-1).data.body ?? ''
}
const heard = await ask('/skill:greet Ana, please', 1)
check(
	heard.startsWith(`<skill name="greet" location="${skill}">`) &&
		heard.includes('Say bonjour.') &&
		!heard.includes('description:') &&
		heard.endsWith('</skill>\n\nAna, please'),
	'a /skill: message reaches the agent as the skill, then the rest',
	heard,
)
const entries = (await api('GET', `/api/threads/${id}`)).json.entries
check(
	entries.some((entry) => entry.data.body === '/skill:greet Ana, please'),
	'the thread keeps the message as typed',
)
const unknown = await ask('/skill:nope hi', 2)
check(unknown === '/skill:nope hi', 'an unknown skill goes as typed', unknown)
done()
