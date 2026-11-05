/** Agents' labels and live work, shared by a thread and its runner. */
import { createRoot, createStore } from 'solid-js'

export const [doing, setDoing] = createRoot(() => createStore({}))
/** How a message names an agent, as util.js does: a bot's name, or the thread's agent as `model@runner` */
export const agentName = (to) => to.name ?? `${to.model}@${to.runner}`

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** `model:thinking@runner`, as pi names a model, or `ada=model@runner` for a bot: util.js's agentTo, with the thinking split off */
export function agentTo(text) {
	const eq = text.indexOf('='),
		rest = text.slice(eq + 1)
	const at = rest.lastIndexOf('@')
	let model = at < 0 ? rest : rest.slice(0, at),
		thinkingLevel
	const colon = model.lastIndexOf(':')
	if (colon >= 0 && THINKING_LEVELS.includes(model.slice(colon + 1)))
		[model, thinkingLevel] = [model.slice(0, colon), model.slice(colon + 1)]
	return {
		runner: at < 0 ? '' : rest.slice(at + 1),
		...(model && { model }),
		...(thinkingLevel && { thinkingLevel }),
		...(eq > 0 && { name: text.slice(0, eq) }),
	}
}
export const formatAgent = ({ model, thinkingLevel, runner, name }) =>
	`${name ? `${name}=` : ''}${model ?? ''}${thinkingLevel ? `:${thinkingLevel}` : ''}@${runner}`

/** In the composer: its name or its model's own name, how hard it thinks, where it runs */
export const agentLabel = (to) =>
	`${to.name ?? (to.model ?? '').split('/').pop()}` +
	`${to.thinkingLevel ? ` · ${to.thinkingLevel}` : ''} · ${to.runner}`
/** An author as a message shows it */
export const authorLabel = (author) =>
	author?.replace(/^(?:[^@]*\/)?([^/@:]+)(?::[^@]*)?@(.+)$/, '$1 · $2') ?? ''

/** What an agent is doing, as the server sends it */
export const messageText = (message) =>
	(message?.content ?? [])
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('')
export const lastToolCall = (doing) => {
	const tool = doing?.run && doing.tools.at(-1)
	if (!tool) return ''
	const args = tool.args ?? {}
	return `${tool.name} ${args.command ?? args.path ?? args.pattern ?? args.query ?? args.body ?? ''}`.trim()
}
