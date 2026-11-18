/** Scripted echo responses for the scratch server; the runner and its tools are real. */
import {
	fauxAssistantMessage,
	fauxThinking,
	fauxToolCall,
	fauxText,
} from '@earendil-works/pi-ai/providers/faux'
import { messageText as text } from './remote.js'
const say = (text) => fauxAssistantMessage([fauxText(text)])
const call = (name, args) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' })
export const personas = {
	ada: 'a careful reviewer',
	bram: 'a blunt engineer',
	cleo: 'a curious designer',
}
/** A bot's reply: its name and persona, how many messages it was just handed, and the newest of them */
const bots = (request) => {
	const system = JSON.stringify(request.messages.filter((m) => m.role === 'system'))
	const name = /You are the bot (\w+)/.exec(system)?.[1]
	if (!name || request.messages.at(-1).role !== 'user') return undefined
	/** A person's words come as typed and everyone else's inside a <message> tag, a blank line between messages */
	const handed = text(request.messages.at(-1))
		.split(/\n\n(?=<message from=")|(?<=\n<\/message>)\n\n/)
		.filter(Boolean)
	const newest = (handed.at(-1) ?? '').replace(/\n/g, ' ').slice(0, 120)
	return say(`${name} (${personas[name]}) got ${handed.length}, newest "${newest}"`)
}
/** The director's pick: the bot whose persona's last word the message uses, else nobody */
const director = (request) => {
	const ask = text(request.messages.at(-1))
	const message = ask.match(/New message: \[[^\]]+\] (.*)/)?.[1]?.toLowerCase() ?? ''
	const name = Object.keys(personas).find((name) =>
		message.includes(personas[name].split(' ').pop().slice(0, 6)),
	)
	return say(
		name ? `${name}: it's about ${personas[name].split(' ').pop()}s` : 'nobody: nothing for them',
	)
}
export const tryEcho = (request) => {
	if (text(request.messages[0] ?? { content: '' }).startsWith('You choose who answers'))
		return director(request)
	const latest = request.messages.at(-1)
	if (latest.role === 'user' && text(latest).startsWith('bot '))
		return call('bot', { instructions: text(latest).slice(4) })
	const bot = bots(request)
	if (bot) return bot
	const last = request.messages.findLastIndex((m) => m.role === 'user')
	const asked = text(request.messages[last])
	if (latest.role === 'toolResult' && latest.toolName === 'bot') return say('Instructions changed.')
	const n = request.messages.slice(last).filter((m) => m.role === 'toolResult').length
	if (n === 0)
		return fauxAssistantMessage(
			[
				fauxThinking(
					`They said "${asked.slice(0, 80)}".\nI'll start a notes file, then look around.`,
				),
				fauxToolCall('write', {
					path: 'notes.md',
					content: `# Notes\n\nasked: ${asked.slice(0, 80)}\n`,
				}),
			],
			{ stopReason: 'toolUse' },
		)
	if (n === 1) return call('read', { path: 'notes.md' })
	if (n === 2)
		return call('edit', {
			path: 'notes.md',
			edits: [{ oldText: '# Notes', newText: '# Notes, edited' }],
		})
	if (n === 3)
		return call('bash', {
			command: `${asked.includes('slow') ? 'sleep 5; ' : ''}ls -la; cat notes.md`,
		})
	if (n === 4 && asked.includes('post') && !/<message from="[^"]*" agent thread=/.test(asked))
		return call('post', {
			title: 'side question',
			body: `${asked.includes('slow') ? 'slow: ' : ''}what did you find?`,
			// "post ada" asks the bot ada instead
			to: Object.keys(personas).find((name) => asked.includes(name)) ?? 'echo/try@bot',
		})
	return say(
		`Done. I wrote, read and edited \`notes.md\`, then ran a command:\n\n\`\`\`\n${text(request.messages.at(-1)).slice(0, 400)}\n\`\`\`\n\n- one\n- two`,
	)
}
