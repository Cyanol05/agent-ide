/** A script's image() saves to the runner's temp folder, and the agent can read it back */
import {
	answered,
	answers,
	api,
	call,
	check,
	done,
	say,
	scriptedRunner,
	server,
	text,
} from './lib.js'

const png =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

await server()
await scriptedRunner('laptop', (request) => {
	const last = request.messages.at(-1)
	if (last.role === 'user')
		return call('codemode', { code: `image('data:image/png;base64,${png}'); return 'shown'` })
	if (last.toolName === 'codemode') {
		const saved = /\/\S+\.png/.exec(text(last))?.[0]
		return saved ? call('read', { path: saved }) : say(`no file: ${text(last)}`)
	}
	return say(
		last.isError
			? `read failed: ${text(last)}`
			: `read ${last.content.filter((block) => block.type === 'image').length} image`,
	)
})

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'image' })
await api('POST', `/api/threads/${id}/entries`, {
	body: 'save an image',
	to: { runner: 'laptop', model: 'echo/echo' },
})
const answer = answers(await answered(id, 1, 15000)).at(-1)?.data.body
check(answer === 'read 1 image', 'the image a script saved opens with read', answer)

done()
