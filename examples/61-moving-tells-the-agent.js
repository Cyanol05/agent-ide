/** Ask a thread's agent on another runner or in another folder and it moves there, keeping its conversation, and is told */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
	answered,
	answers,
	api,
	brief,
	call,
	check,
	conversationOf,
	dir,
	done,
	say,
	scriptedRunner,
	server,
	text,
} from './lib.js'

await server()
mkdirSync(path.join(dir, 'site'))
const heard = { laptop: [], vps: [] }
const route = (runner) => (request) => {
	const last = request.messages.findLast((m) => m.role !== 'system')
	if (last.role === 'toolResult') return say(`${runner} in ${text(last).trim()}`)
	heard[runner].push(JSON.stringify(request.messages))
	return call('bash', { command: 'pwd' })
}
await scriptedRunner('laptop', route('laptop'))
await scriptedRunner('vps', route('vps'))
const id = (await api('POST', '/api/threads', { title: 'move' })).json.id
const ask = async (body, to, n) => {
	await api('POST', `/api/threads/${id}/entries`, { body, to })
	const v = await answered(id, n)
	const own = await conversationOf(v, v.agents[0].name)
	return {
		v,
		answer: answers(v).at(-1)?.data.body,
		told: text(own.entries.filter((e) => e.kind === 'agent-ide.delivery').at(-1)?.model[0]),
		cwd: own.docs['pi.agent'].cwd,
	}
}

const before = await ask('where are you?', { runner: 'laptop', model: 'echo/echo' }, 1)
const conversation = before.v.agents[0].conversation
const moved = await ask('and now?', { runner: 'vps', model: 'echo/echo', dir: 'site' }, 2)
check(
	moved.v.agents.length === 1 &&
		moved.v.agents[0].conversation === conversation &&
		moved.v.agents[0].to.runner === 'vps' &&
		moved.v.agents[0].to.dir === 'site' &&
		moved.answer === `vps in ${path.join(dir, 'site')}`,
	"asked on the vps in site, the thread's agent moves there: its tools run on the vps, in that folder",
	JSON.stringify([moved.v.agents, moved.answer]),
)
check(
	heard.vps.at(-1).includes('where are you?') && heard.vps.at(-1).includes(`laptop in ${dir}`),
	'it keeps its conversation, what it did on the laptop included',
	heard.vps.at(-1)?.slice(0, 200),
)
check(
	moved.told.startsWith(
		`[You now run as echo/echo on vps, in ${path.join(dir, 'site')}. Files and paths from before may not be here`,
	) && moved.told.endsWith('oskar: and now?'),
	'it is told where it is now, and not to trust paths from before',
	moved.told,
)

const stays = await ask('again', { runner: 'vps', model: 'echo/echo' }, 3)
check(
	stays.cwd === path.join(dir, 'site') && stays.told === 'oskar: again',
	'the same runner without a folder keeps the folder, and says nothing new',
	JSON.stringify([stays.cwd, stays.told]),
)

const back = await ask('home', 'echo/echo@laptop', 4)
check(
	back.cwd === dir &&
		back.v.agents[0].to.dir === undefined &&
		back.told.startsWith(`[You now run as echo/echo on laptop, in ${dir}.`) &&
		back.answer === `laptop in ${dir}`,
	"another runner without a folder starts at that runner's own",
	JSON.stringify([back.cwd, back.told, brief(back.v)]),
)
done()
