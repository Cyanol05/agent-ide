/** The scratch model uses the real runner, including context, file tools, posts and bot changes. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
	answered,
	answers,
	api,
	check,
	conversationOf,
	dir,
	done,
	runner,
	server,
	view,
	until,
} from './lib.js'

mkdirSync(path.join(dir, '.pi/skills/try-skill'), { recursive: true })
writeFileSync(
	path.join(dir, '.pi/skills/try-skill/SKILL.md'),
	'---\nname: try-skill\ndescription: A scratch skill\n---\nScratch skill instructions.\n',
)
writeFileSync(path.join(dir, 'AGENTS.md'), 'The scratch context marker.\n')
await server({ MODULES: '+bots,+director', DIRECTOR_MODEL: 'echo/try@bot' })
await runner('bot')
const to = 'echo/try@bot'
const { json: thread } = await api('POST', '/api/threads', { title: 'try tools' })
await api('POST', `/api/threads/${thread.id}/entries`, { body: 'look around', to })
const result = await answered(thread.id)
check(
	answers(result ?? { entries: [] }).some((entry) => entry.data.body.startsWith('Done.')),
	'echo/try finishes its real tools',
)
check(
	readFileSync(path.join(dir, 'notes.md'), 'utf8').startsWith('# Notes, edited'),
	'write, read and edit run in the runner folder',
)
const own = await conversationOf(await view(thread.id), to)
check(
	JSON.stringify(own).includes('The scratch context marker.'),
	'AGENTS.md reaches the model through the context module',
)
check(
	JSON.stringify(own).includes('try-skill'),
	'skills reach the model through the context module',
)
await api('POST', `/api/threads/${thread.id}/entries`, { body: 'post', to })
await answered(thread.id, 2)
const children = (await api('GET', '/api/threads')).json.filter(
	(row) => row.title === 'side question',
)
check(
	children.length === 1 && answers(await answered(children[0].id)).length === 1,
	'post asks another real-runner agent and gets its answer',
)
await api('POST', '/api/bots', { name: 'ada', to, instructions: 'a careful reviewer' })
const { json: room } = await api('POST', '/api/threads', { title: 'try bots' })
await api('POST', `/api/threads/${room.id}/entries`, { body: 'hello', to: 'ada' })
const bot = await answered(room.id)
check(
	answers(bot)[0]?.data.body === 'ada (a careful reviewer) got 1, newest "hello"',
	'the bot names itself, its persona, count and newest message',
)
await api('POST', `/api/threads/${room.id}/entries`, { body: 'review this' })
const picked = await answered(room.id, 2)
check(answers(picked).length === 2, 'the scripted director still picks the reviewer')
const home = (await api('GET', '/api/bots')).json.find((bot) => bot.name === 'ada').home
await api('POST', `/api/threads/${home}/entries`, { body: 'bot a changed reviewer', to: 'ada' })
await answered(home)
check(
	(await api('GET', '/api/bots')).json.find((bot) => bot.name === 'ada')?.instructions ===
		'a changed reviewer',
	'echo/try calls the real bot tool',
)
const { json: slow } = await api('POST', '/api/threads', { title: 'try slow post' })
await api('POST', `/api/threads/${slow.id}/entries`, { body: 'slow post', to })
check(
	Boolean(
		await until(async () => {
			const own = await conversationOf(await view(slow.id), to)
			return own.entries?.some((entry) =>
				entry.model?.some((message) =>
					message.content?.some?.(
						(block) =>
							block.type === 'toolCall' &&
							block.name === 'bash' &&
							block.arguments.command.startsWith('sleep 5;'),
					),
				),
			)
		}),
	),
	'slow post starts a real slow command',
)
await api('POST', `/api/threads/${slow.id}/stop`)
check(
	(await view(slow.id)).status === 'idle',
	'the real slow command can be stopped without waiting it out',
)
done()
