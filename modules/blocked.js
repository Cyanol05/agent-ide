/**
 * Agents can ask a question that blocks the thread until a person next writes.
 * Off by default; MODULES=+blocked turns it on.
 */
import { obj, str } from '@earendil-works/pi-schema'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { writtenTo } from '../util.js'

export const on = false

export function server(core) {
	const askPerson = defineTool({
		name: 'ask_person',
		description:
			'Post a question in this thread that only a person can answer. It stays blocked until a person writes; do not repeat the question in your final answer.',
		parameters: obj({ body: str({ description: 'The question the person must answer' }) }),
		replay: 'safe',
		execute: async ({ body }, api) => {
			if (!body.trim()) throw new Error('body is required')
			const { thread, name } = await core.home(api.conversationId)
			const author = writtenTo(await core.agentOf(api.conversationId, name))
			return core.once(`ask_person ${api.taskId}`, 'ask_person', async (tx) => {
				await core.post(
					tx,
					thread,
					{ author, body: body.trim(), waitingOnPerson: true },
					{ member: true },
				)
				return {
					output: [
						{ type: 'text', text: 'Asked the person. The thread is blocked until they write.' },
					],
				}
			})
		},
	})
	return {
		extension: defineExtension({
			name: 'ade.blocked',
			tools: [askPerson],
			sections: [
				{
					key: 'blocked',
					tag: false,
					render: () => 'Use ask_person only when you truly cannot go on without the person.',
				},
			],
		}),
		waitingOnPerson: async (id, row) => {
			const latest = (await core.messages(id)).findLast(
				(entry) => entry.data.waitingOnPerson || core.person(row, entry),
			)
			return latest?.data.waitingOnPerson === true
		},
	}
}
