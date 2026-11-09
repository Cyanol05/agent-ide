/** Shared setup, transcript evidence and the one-line score for the real-model bench. */
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { api, check as checked, conversationOf, repo, runner, server, until, view } from './lib.js'

if (process.env.REAL !== '1') {
	console.log('skip: REAL=1 runs the real-model bench')
	process.exit(0)
}

export const model = process.argv[2] || 'gpt-6-luna:low'
export const agent = `${model}@oskar`
const started = Date.now()
const failed = []
/** Each agent's steps and tokens, by thread and name; a conversation only grows, so the latest read wins */
const scored = new Map()

export async function bench({ web = false, env = {} } = {}) {
	await server({ MODULES: `+bots,+director${web ? ',+web-search' : ''}`, ...env })
	await runner('oskar', { env: { HOME: os.homedir() } })
	console.log(`model: ${agent}`)
}
export async function bot(name, instructions = '') {
	const result = await api('POST', '/api/bots', { name, to: agent, instructions })
	if (result.status !== 201) throw new Error(JSON.stringify(result))
	return result.json.home
}
export async function thread(title) {
	return (await api('POST', '/api/threads', { title })).json.id
}
export async function post(id, body, to) {
	const result = await api('POST', `/api/threads/${id}/entries`, {
		body,
		...(to === undefined ? {} : { to }),
	})
	if (result.status !== 201) throw new Error(JSON.stringify(result))
}
/** Wait for deliveries, including answers that wake the asker, not a fixed quiet period. */
export async function settled(ms = 120000) {
	const rows = await until(async () => {
		const rows = (await api('GET', '/api/threads')).json
		return rows.every((row) => !['working', 'blocked'].includes(row.status)) && rows
	}, ms)
	check(Boolean(rows), 'all deliveries finished')
	return rows || (await api('GET', '/api/threads')).json
}
/** Each thread's entries, its agents' conversations and tool calls, logged; every agent read here is scored */
export async function evidence(ids) {
	const result = []
	for (const id of ids) {
		const current = await view(id)
		const calls = []
		const conversations = {}
		console.log(`agents #${id}: ${JSON.stringify(current.agents)}`)
		console.log(`thread #${id}: ${JSON.stringify(current.entries)}`)
		for (const { name } of current.agents) {
			const conversation = await conversationOf(current, name)
			conversations[name] = conversation
			const score = { steps: 0, errors: 0, input: 0, output: 0, cacheRead: 0 }
			for (const entry of conversation.entries)
				for (const message of entry.model || []) {
					if (message.role === 'toolResult' && message.isError) score.errors++
					if (message.role !== 'assistant') continue
					score.input += message.usage?.input || 0
					score.output += message.usage?.output || 0
					score.cacheRead += message.usage?.cacheRead || 0
					for (const part of message.content || [])
						if (part.type === 'toolCall') {
							score.steps++
							calls.push({ agent: name, ...part })
						}
				}
			scored.set(`${id}/${name}`, { name, ...score })
		}
		console.log(`calls #${id}: ${JSON.stringify(calls)}`)
		result.push({ ...current, calls, conversations })
	}
	return result
}
/** An agent's tool calls in every thread read so far, against the most a good run needs */
export function steps(name, most) {
	const used = [...scored.values()]
		.filter((score) => score.name === name)
		.reduce((sum, score) => sum + score.steps, 0)
	check(used <= most, `${name} takes at most ${most} steps`, `took ${used}`)
}
export function check(ok, what, extra) {
	checked(ok, what, extra)
	if (!ok) failed.push(what)
}
/** Prints the run's score as one `score {…}` line, then exits as the checks went */
export function done() {
	let revision
	try {
		revision = execFileSync(
			'jj',
			['log', '--ignore-working-copy', '-r', '@', '-T', 'commit_id', '--no-graph'],
			{ cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		).slice(0, 8)
	} catch {}
	const total = { steps: 0, errors: 0, input: 0, output: 0, cacheRead: 0 }
	for (const score of scored.values()) for (const key in total) total[key] += score[key]
	const line = {
		case: path.basename(process.argv[1], '.js').replace(/-real-model$/, ''),
		model: agent,
		...(revision && { revision }),
		pass: !failed.length,
		failed,
		...total,
		wall_ms: Date.now() - started,
	}
	console.log(`score ${JSON.stringify(line)}`)
	console.log(failed.length ? `${failed.length} failed` : 'all ok')
	process.exit(failed.length ? 1 : 0)
}
