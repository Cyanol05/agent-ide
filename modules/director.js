/** Asks the bots a message @mentions, by name in any case, instead of whom the thread asked last. An agent written out, model@runner, is never a mention. MODULES=+director */

/** The thread's bots a message @mentions; none, and the message asks as it would without the director */
export const server = () => ({ route })

function route({ body }, agents) {
	/** Bot names are written as they read, but people type them in any case */
	const bots = new Map(
		agents.filter((agent) => agent.name).map((bot) => [bot.name.toLowerCase(), bot]),
	)
	const mentioned = [...body.matchAll(/@([\w.-]+)/g)]
		.map(([, name]) => bots.get(name.replace(/\.+$/, '').toLowerCase()))
		.filter(Boolean)
	return [...new Set(mentioned)]
}
