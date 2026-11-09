/** A command an agent runs knows who it is: the CLI in its shell posts as the agent, not whoever owns the machine */
import {
	api,
	base,
	call,
	check,
	done,
	repo,
	scriptedRunner,
	server,
	say,
	text,
	until,
	view,
} from './lib.js'

await server()
await scriptedRunner(
	'laptop',
	(request) => {
		const last = request.messages.at(-1)
		if (last.role === 'user')
			return call('bash', {
				command: `node ${repo}/cli.js --server ${base} post --to nobody --no-wait "posted from the agent's shell"`,
			})
		return say(`done: ${text(last)}`)
	},
	{},
)

const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'asks' })
await api('POST', `/api/threads/${id}/entries`, {
	body: 'go',
	to: 'echo/echo:low@laptop',
})
const posted = async () => {
	const thread = (await api('GET', '/api/threads')).json.find((t) =>
		t.title?.includes('posted from'),
	)
	return thread && (await view(thread.id)).entries[0]
}
const entry = await until(posted, 30000)
check(
	entry?.data.author === 'echo:low',
	"a post from the agent's own shell shows as the agent, not the person",
	entry?.data.author,
)
done()
