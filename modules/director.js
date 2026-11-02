import { agentName } from '../util.js'

/** Whom a message asks: the agents it @mentions, else its own `to`, or nobody */
export const server = () => ({ route })

function route({ body, to }, agents) {
	const named = new Map(agents.map((agent) => [agentName(agent), agent]))
	const picked = [...body.matchAll(/@([\w./-]+(?:@[\w.-]+)?)/g)]
		.map(([, name]) => named.get(name.replace(/\.+$/, '')))
		.filter(Boolean)
	return picked.length ? [...new Set(picked)] : to
}
