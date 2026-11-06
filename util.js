/** Pure helpers the server and its modules share */

export async function collect(scan) {
	const items = []
	let cursor
	do {
		const page = await scan(cursor)
		items.push(...page.items)
		cursor = page.next
	} while (cursor)
	return items
}

/** How a `to` is written: a bot's name, or the thread's agent as its recipe `model@runner` */
export const writtenTo = (to) => to && (to.name ?? `${to.model}@${to.runner}`)
/** The thread's own agent's key among its agents; bots are keyed by name */
export const AGENT = 'agent'
/** Bot names have no `@`, so any name with one is the thread's agent, whatever model it had */
export const keyOf = (name) => (name.includes('@') ? AGENT : name)
/** `model@runner`, or a bare runner for its default model; `ada=model@runner` asks the bot ada as that */
export const agentTo = (name) => {
	const eq = name.indexOf('=')
	const recipe = name.slice(eq + 1)
	const at = recipe.lastIndexOf('@')
	return {
		runner: recipe.slice(at + 1),
		model: at < 0 ? '' : recipe.slice(0, at),
		...(eq > 0 ? { name: name.slice(0, eq) } : {}),
	}
}
/** A person's name as one line of printable text, so no author can write a speaker line of their own */
export const speaker = (name) =>
	[
		...String(name ?? '')
			.normalize('NFKC')
			.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
			.replace(/\s+/g, ' ')
			.trim(),
	]
		.slice(0, 40)
		.join('')
		.trim() || 'anon'

export function field(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
	return value.trim()
}

/** A message as an agent reads it */
export function said({ data: message }) {
	const agent = Boolean(message.answer || message.error || message.from)
	const who = agent
		? `${message.author} (agent${message.from ? `, ${message.re ? 'answering' : 'writing'} from thread ${message.from}` : ''})`
		: message.author
	const output = message.shell
		? `\n${[`exit ${message.shell.code ?? message.shell.error}`, message.shell.stdout, message.shell.stderr].filter(Boolean).join('\n')}`
		: ''
	return `${who}: ${`${message.body}${output}`.replace(/\n/g, '\n  ')}`
}
