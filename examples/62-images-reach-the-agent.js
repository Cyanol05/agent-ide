/** A message's images go with its words: kept on the message, and handed to the agent as pi's ImageContent */
import { answered, api, check, done, say, scriptedRunner, server, view } from './lib.js'

await server()
const seen = []
await scriptedRunner(
	'x',
	(context) => {
		const content = context.messages.findLast((m) => m.role === 'user')?.content
		const images = Array.isArray(content) ? content.filter((b) => b.type === 'image') : []
		seen.push(images)
		return say(`${images.length} image${images.length === 1 ? '' : 's'}`)
	},
	{ model: { input: ['text', 'image'] } },
)

// A 1×1 PNG
const dot = {
	type: 'image',
	mimeType: 'image/png',
	data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
}
const to = { runner: 'x', model: 'echo/echo' }
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'images' })

await api('POST', `/api/threads/${id}/entries`, { body: 'what is this?', to, images: [dot] })
let v = await answered(id, 1)
check(v.entries[0].data.images?.[0]?.data === dot.data, 'the message keeps its image')
check(
	seen[0]?.length === 1 && seen[0][0].data === dot.data && seen[0][0].mimeType === 'image/png',
	'the agent gets it as ImageContent, beside the words',
)

await api('POST', `/api/threads/${id}/entries`, { images: [dot, dot] })
v = await answered(id, 2)
check(seen[1]?.length === 2 && v.entries.at(-2).data.body === '', 'images alone are a message')

const bad = await api('POST', `/api/threads/${id}/entries`, {
	body: 'x',
	images: [{ type: 'image', mimeType: 'text/html', data: 'PGI+' }],
})
check(bad.status === 400 && /images/.test(bad.json.error), 'anything but an image is turned away', bad.json.error)

const none = await api('POST', `/api/threads/${id}/entries`, { body: ' ' })
check(none.status === 400, 'no words and no images is still nothing to send')

done()
