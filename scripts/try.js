/** A scratch agent-ide to click through: its own store and port, a scripted runner `bot`, and one thread it has already answered.
 * `node scripts/try.js &`, open the address it prints, stop it with the `kill` line it prints. Every server it starts goes with it.
 * The bot's model, echo/echo, writes, reads, edits and runs a command in its folder, then answers in markdown.
 * A message with "post" in it makes it post to a new thread too; "slow" makes the command take five seconds, to watch live work. */
import { api, base, call, dir, say, scriptedRunner, server, text } from '../examples/lib.js'

process.on('SIGTERM', () => process.exit(0))

await server()
const step = (request) => {
	const last = request.messages.findLastIndex((m) => m.role === 'user')
	const asked = text(request.messages[last])
	const n = request.messages.slice(last).filter((m) => m.role === 'toolResult').length
	if (n === 0) return call('write', { path: 'notes.md', content: `# Notes\n\nasked: ${asked.slice(0, 80)}\n` })
	if (n === 1) return call('read', { path: 'notes.md' })
	if (n === 2) return call('edit', { path: 'notes.md', edits: [{ oldText: '# Notes', newText: '# Notes, edited' }] })
	if (n === 3) return call('bash', { command: `${asked.includes('slow') ? 'sleep 5; ' : ''}ls -la; cat notes.md` })
	if (n === 4 && asked.includes('post') && !asked.includes('from thread'))
		return call('post', { title: 'side question', body: 'what did you find?', to: 'echo/echo@bot' })
	return say(`Done. I wrote, read and edited \`notes.md\`, then ran a command:\n\n\`\`\`\n${text(request.messages.at(-1)).slice(0, 400)}\n\`\`\`\n\n- one\n- two`)
}
await scriptedRunner('bot', step)

const { json: thread } = await api('POST', '/api/threads', { title: 'try me' })
await api('POST', `/api/threads/${thread.id}/entries`, { body: 'look around', to: { runner: 'bot', model: 'echo/echo' } })

console.log(`agent-ide at ${base}/?thread=${thread.id}
the bot works in ${dir}; send to echo/echo@bot, "post" or "slow" in a message for more
stop: kill ${process.pid}`)
