/** MODULES=+search gives agents `web_search`, through Exa's free search; SEARCH_URL points it at another MCP endpoint */
import { num, obj, opt, str } from '@earendil-works/pi-schema'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'

const url = process.env.SEARCH_URL || 'https://mcp.exa.ai/mcp?tools=web_search_exa'

export function server() {
	const search = defineTool({
		name: 'web_search',
		description:
			"Search the web. Answers with each page's title, address and highlights; read a page whole with curl.",
		parameters: obj({
			query: str(),
			results: opt(num({ description: 'How many pages, 5 by default, at most 10' })),
		}),
		replay: 'safe',
		execute: async ({ query, results = 5 }, api, context) => {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'web_search_exa',
						arguments: { query, numResults: Math.min(results, 10) },
					},
				}),
				signal: context.abortSignal,
			})
			if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`.slice(0, 500))
			const raw = await res.text()
			const reply = JSON.parse(
				raw.includes('data:')
					? raw
							.split('\n')
							.findLast((line) => line.startsWith('data:'))
							.slice(5)
					: raw,
			)
			if (reply.error || reply.result?.isError)
				throw new Error(reply.error?.message ?? reply.result.content?.[0]?.text ?? 'search failed')
			const text = (reply.result?.content ?? [])
				.map((part) => part.text ?? '')
				.join('\n')
				.slice(0, 30000)
			return { output: [{ type: 'text', text: text || 'Nothing found.' }] }
		},
	})
	return { extension: defineExtension({ name: 'agent-ide.search', tools: [search] }) }
}
