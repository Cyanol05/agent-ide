/**
 * Shows on a runner's terminal what its agents are doing, as OSC 7501 status, if the terminal speaks it.
 * On by default; MODULES=-status turns it off. STATUS=1 on a runner skips asking the terminal, for when stdout isn't one.
 */

/** One telling at a time, so an older one never lands after a newer one */
export function server({ runners, known, threadList }) {
	let telling
	let again = false
	function changed() {
		if (telling) return void (again = true)
		telling = (async () => {
			const all = await known()
			for (const name of Object.keys(all).filter(runners.isOnline)) {
				const threads = (await threadList(all[name].owner))
					.map((thread) => ({
						...thread,
						agents: thread.agents
							.filter((agent) => agent.to?.runner === name)
							.map((agent) => agent.name)
							.join(' '),
					}))
					.filter((thread) => thread.agents && thread.status !== 'idle')
					.map(({ id, title, agents, status }) => ({ id, title, agents, status }))
				runners.tell(name, { op: 'status', threads })
			}
		})()
			.catch((error) => console.error(error))
			.finally(() => {
				telling = undefined
				if (again) {
					again = false
					changed()
				}
			})
	}
	return { changed }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g
/** Cut by characters so the limits hold in UTF-8 */
const base64 = (text, max) =>
	Buffer.from([...text.replace(CONTROL_CHARACTERS, ' ').trim()].slice(0, max).join('')).toString(
		'base64',
	)
function programStatus({ state, id, app, title, msg }) {
	const pairs = [
		`state=${state}`,
		id && `id=${id}`,
		app && `app=${app}`,
		title && `title=${base64(title, 48)}`,
		msg && `msg=${base64(msg, 500)}`,
	]
	return `\x1b]7501;${pairs.filter(Boolean).join(':')}\x1b\\`
}

/** A terminal that speaks OSC 7501 answers its query before the device attributes every terminal answers */
function detect() {
	if (process.env.STATUS === '1') return Promise.resolve(true)
	if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false)
	return new Promise((resolve) => {
		let reply = ''
		const done = (supported) => {
			clearTimeout(timer)
			process.stdin.off('data', read).setRawMode(false).pause()
			resolve(supported)
		}
		const read = (chunk) => {
			reply += chunk
			if (reply.includes('\x1b]7501;?')) done(true)
			else if (/\x1b\[\?[\d;]*c/.test(reply)) done(false)
		}
		const timer = setTimeout(() => done(false), 1000)
		process.stdin.setRawMode(true).setEncoding('utf8').on('data', read)
		process.stdout.write('\x1b]7501;?\x1b\\\x1b[c')
	})
}

export async function runner({ name, server }) {
	if (!(await detect())) return {}
	let reported = new Map()
	function report(root, threads = []) {
		const next = new Map([
			['', programStatus({ state: root.state, app: 'agent-ide', msg: root.msg })],
		])
		for (const thread of threads)
			next.set(
				String(thread.id),
				programStatus({ state: thread.status, id: thread.id, title: `#${thread.id} ${thread.title}`, msg: thread.agents }),
			)
		for (const id of reported.keys())
			if (!next.has(id)) process.stdout.write(programStatus({ state: 'clear', id }))
		for (const [id, sequence] of next)
			if (reported.get(id) !== sequence) process.stdout.write(sequence)
		reported = next
	}
	return {
		told({ threads }) {
			const working = threads.filter((thread) => thread.status === 'working').length
			report(
				{
					state: working ? 'working' : 'idle',
					msg: working ? `${name}: ${working} working` : `${name}: online at ${server}`,
				},
				threads,
			)
		},
		disconnected: () => report({ state: 'idle', msg: `${name}: offline, retrying ${server}` }),
	}
}
