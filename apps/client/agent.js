/** Agents' labels and live work, shared by a thread and its runner. */
import { createRoot, createStore } from 'solid-js'

export const [doing, setDoing] = createRoot(() => createStore({}))

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** A thinking level in the picker's short words */
export const thinkingWord = (level) => ({ minimal: 'min', medium: 'med' })[level] ?? level

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

/** How a `to` is written, shown and typed alike, as util.js does: a bot's name, or the thread's agent as
 * `model:thinking@runner`, the model by its own name without its provider */
export const writtenTo = (to) =>
	to.name ??
	`${(to.model ?? '').split('/').pop()}${to.thinkingLevel ? `:${to.thinkingLevel}` : ''}@${to.runner}`

/** What you type to ask it: the agent written out, and for a bot `ada=` before it */
export const formatAgent = (to) =>
	`${to.name ? `${to.name}=` : ''}${writtenTo({ ...to, name: undefined })}`

/** An author as a message shows it: a person's or bot's name, or an agent written out, older `provider/id` ones too */
export const authorLabel = (author) =>
	author?.includes('@') ? writtenTo(agentTo(author)) : (author ?? '')

/** An author in a few words, as an ask's line says it: a bot's or person's name, or an agent's model alone */
export const shortLabel = (author) => {
	if (!author?.includes('@')) return author ?? ''
	const to = agentTo(author)
	return to.name ?? to.model?.split('/').pop() ?? author
}

/** A runner's row for a model, whatever its thinking: a bot's name, or `provider/id@runner`, as /api/runners keys its agents */
export const rowOf = (to) => to.name ?? `${to.model}@${to.runner}`

export const messageText = (message) =>
	(message?.content ?? [])
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('')

export const lastToolCall = (doing) => {
	const tool = doing?.run && doing.tools.at(-1)
	return tool ? toolLine(tool) : ''
}
const toolLine = (tool) => `${tool.name} ${touched(tool.args) ?? ''}`.trim()

/** The argument that says what a tool call touches, if it has one */
export const touched = (args = {}) =>
	args.command ?? args.path ?? args.pattern ?? args.query ?? args.code ?? args.body

/** The chosen model, the runner's default, and every model it offers, once each. */
export const modelsOf = (runner, to) => [
	...new Set([to.model, runner.model, ...(runner.offers ?? [])].filter(Boolean)),
]
