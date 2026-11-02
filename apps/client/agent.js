// How an agent is named and what it's doing, as plain functions: no state, no page.

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// model:thinking@runner, as pi names a model: the last @ splits off the runner, a last :thinkingLevel the thinking.
// name=model@runner names the agent it makes.
export function parseAgent(text) {
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
// An agent's row on its runner's card: its name there, model@runner unless it was given another.
export const agentKey = ({ runner, model, name }) => `${name ?? model}@${runner}`
export const sameAgent = (a, b) =>
	a?.runner === b?.runner && a?.model === b?.model && a?.name === b?.name

// In the composer: its name or its model's own name, how hard it thinks, where it runs.
export const agentLabel = (p) =>
	`${p.name ?? (p.model ?? '').split('/').pop()}${p.thinkingLevel ? ` · ${p.thinkingLevel}` : ''} · ${p.runner}`
// An author as a message shows it: an agent by its model's own name and where it runs; the full id is on hover.
export const authorLabel = (author) =>
	author?.replace(/^(?:[^@]*\/)?([^/@:]+)(?::[^@]*)?@(.+)$/, '$1 · $2') ?? ''

// The busiest of some agents decides a dot: working beats blocked, and idle is grey.
export const busiest = (agents) =>
	agents.some((a) => a.status === 'working')
		? 'working'
		: agents.some((a) => a.status === 'blocked')
			? 'blocked'
			: ''

// What an agent is doing, as the server sends it: the reply it's writing, and its latest tool call.
export const messageText = (message) =>
	(message?.content ?? [])
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('')
export const lastToolCall = (doing) => {
	const t = doing?.run && doing.tools.at(-1)
	if (!t) return ''
	const a = t.args ?? {}
	return `${t.name} ${a.command ?? a.path ?? a.pattern ?? a.query ?? a.body ?? ''}`.trim()
}
