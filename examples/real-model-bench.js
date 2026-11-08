/** Shared setup and plain transcript evidence for the real-model move bench. */
import os from 'node:os'
import { api, check, conversationOf, done, runner, server, until, view } from './lib.js'

if (process.env.REAL !== '1') {
	console.log('skip: REAL=1 runs the real-model move bench')
	process.exit(0)
}

export const model = process.argv[2] || 'gpt-6-luna:low'
export async function bench(web = false) {
	await server({ MODULES: `+bots,+director${web ? ',+web-search' : ''}` })
	await runner('oskar', { env: { HOME: os.homedir() } })
	console.log(`model: ${model}@oskar`)
}
export async function bot(name, instructions = '') {
	const result = await api('POST', '/api/bots', { name, to: `${model}@oskar`, instructions })
	if (result.status !== 201) throw new Error(JSON.stringify(result))
	return result.json.home
}
export async function thread(title) {
	return (await api('POST', '/api/threads', { title })).json.id
}
export async function post(id, body, to) {
	const result = await api('POST', `/api/threads/${id}/entries`, { body, ...(to === undefined ? {} : { to }) })
	if (result.status !== 201) throw new Error(JSON.stringify(result))
}
/** Wait for deliveries, including answers that wake the asker, not a fixed quiet period. */
export async function settled() {
	const rows = await until(async () => {
		const rows = (await api('GET', '/api/threads')).json
		return rows.every((row) => !['working', 'blocked'].includes(row.status)) && rows
	}, 120000)
	check(Boolean(rows), 'all deliveries finished')
	return rows || (await api('GET', '/api/threads')).json
}
export async function evidence(ids) {
	const result = []
	for (const id of ids) {
		const current = await view(id)
		const calls = []
		console.log(`agents #${id}: ${JSON.stringify(current.agents)}`)
		console.log(`thread #${id}: ${JSON.stringify(current.entries)}`)
		for (const agent of current.agents) {
			const conversation = await conversationOf(current, agent.name || `${agent.to.model}@${agent.to.runner}`)
			for (const entry of conversation.entries)
				for (const message of entry.model || [])
					if (message.role === 'assistant')
						for (const part of message.content || [])
							if (part.type === 'toolCall') calls.push({ agent: agent.name, ...part })
		}
		console.log(`calls #${id}: ${JSON.stringify(calls)}`)
		result.push({ ...current, calls })
	}
	return result
}
export { check, done }
