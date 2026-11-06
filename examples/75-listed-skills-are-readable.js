/** An agent reads the skills it was shown, even outside its runner's folder; nothing else out there */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runner as context } from '../modules/context.js'
import {
	answered,
	api,
	call,
	check,
	dir,
	done,
	home,
	say,
	scriptedRunner,
	server,
	text,
} from './lib.js'

// Pi finds user skills in ~/.agents/skills, outside the runner's folder
process.env.HOME = home
const skill = path.join(home, '.agents/skills/peek/SKILL.md')
mkdirSync(path.dirname(skill), { recursive: true })
writeFileSync(skill, '---\nname: peek\ndescription: Peek at things.\n---\nLook twice.')
const secret = path.join(home, 'secret.txt')
writeFileSync(secret, 'the key is under the mat')

/** Each message names a file to read; the agent answers with what the tool said */
const route = (request) => {
	const last = request.messages.findLast((m) => m.role !== 'system')
	if (last.role === 'toolResult') return say(`tool said: ${text(last)}`)
	const asked = text(last)
	if (asked.includes('write')) return call('write', { path: skill, content: 'Look once.' })
	return call('read', { path: asked.includes('skill') ? skill : secret })
}
const listed = context({ name: 'bot', dir, roots: [dir] })
await server()
await scriptedRunner('bot', route, { ops: { context: listed.call }, readable: listed.readable })

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'skills', tools: ['-write', '-edit', '-bash'] })
const ask = async (body, n, thread = id) => {
	await api('POST', `/api/threads/${thread}/entries`, {
		body,
		to: { runner: 'bot', model: 'echo/echo' },
	})
	return (await answered(thread, n))?.entries.at(-1).data.body ?? ''
}
const read = await ask('read the skill', 1)
check(
	read.includes('Look twice.'),
	'a hands-off agent reads a listed skill outside its folder',
	read,
)
const other = await ask('read the secret', 2)
check(
	other.includes('outside bot') && !other.includes('under the mat'),
	'but not another file out there',
	other,
)
const {
	json: { id: hands },
} = await api('POST', '/api/threads', { title: 'skills, every tool' })
const wrote = await ask('write the skill', 1, hands)
check(
	wrote.includes('outside bot') && readFileSync(skill, 'utf8').includes('Look twice.'),
	'even with every tool, the skill stays as it was',
	wrote,
)
done()
