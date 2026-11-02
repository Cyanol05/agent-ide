/** MODULES=+bots */
import { obj, opt, str } from '@earendil-works/pi-schema'
import { defineDoc, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { agentTo } from '../util.js'

/** A bot's name → { home */
const Bots = defineDoc({
	kind: 'agent-ide.bots',
	version: 1,
	scope: 'session',
	checkpointWhen: () => true,
	initial: () => ({}),
})
const HANDS_OFF = ['-write', '-edit', '-bash']

export function server(core) {
	const bots = () => core.commit(async (tx) => JSON.parse(JSON.stringify(await tx.doc(Bots))))
	const list = async () => Object.entries(await bots()).map(([name, bot]) => ({ name, ...bot }))

	async function change({ name, to, instructions }) {
		if (typeof name !== 'string' || !/^[\w.-]{1,40}$/.test(name))
			throw new Error('A name is 1 to 40 letters, digits, _ . or -')
		if ((await core.known())[name]) throw new Error(`${name} is a runner; pick another name`)
		if (instructions !== undefined && typeof instructions !== 'string')
			throw new Error('instructions is text')
		if (to !== undefined) {
			const { name: _, ...recipe } = await core.address(typeof to === 'string' ? agentTo(to) : to)
			to = recipe
		}
		return { name, to, instructions }
	}
	async function write(tx, author, { name, to, instructions }) {
		const all = await tx.doc(Bots)
		if (!all[name]) {
			if (!to) throw new Error(`${name} is new: give it a recipe, to: model@runner`)
			const home = await core.startThread(tx, author, name, null, HANDS_OFF)
			all[name] = { home, to, instructions: instructions ?? '' }
		} else {
			if (to) all[name].to = to
			if (instructions !== undefined) all[name].instructions = instructions
		}
		return JSON.parse(JSON.stringify({ name, ...all[name] }))
	}

	async function serve(id, query, body) {
		if (id !== undefined) throw new Error('Bots live at /api/bots')
		if (body === undefined) return list()
		const asked = await change(body)
		return core.once(body.requestId, `bot ${asked.name}`, (tx) => write(tx, 'anon', asked))
	}
	async function remove(name) {
		return core.commit(async (tx) => {
			const all = await tx.doc(Bots)
			if (!all[name]) throw Object.assign(new Error(`No bot ${name}`), { status: 404 })
			delete all[name]
			return { name }
		})
	}

	async function hiding(tx, threadId) {
		const [name] = Object.entries(await tx.doc(Bots)).find(([, b]) => b.home === threadId) ?? []
		if (name) throw new Error(`Thread ${threadId} is ${name}'s home; forget ${name} first`)
	}

	async function recipe(name) {
		const bot = (await bots())[name]
		return bot && { ...bot.to, name }
	}

	const bot = defineTool({
		name: 'bot',
		description:
			'Only for a bot, in its home thread. Leave out `name`, or give your own, to rewrite yourself: your instructions, ' +
			'which every agent of your name reads, or the model you join new threads with. A new name makes another bot, ' +
			'with its own home thread, from your model unless you give one.',
		parameters: obj({
			name: opt(str({ description: 'A new bot to make; leave out for yourself' })),
			instructions: opt(
				str({
					description:
						'The whole text: who the bot is, how it works, what it knows about the people it works with',
				}),
			),
			model: opt(str({ description: 'model@runner, as `pi --model` takes the model' })),
		}),
		replay: 'safe',
		execute: async (args, api) => {
			const at = await core.home(api.conversationId)
			const mine = at && (await bots())[at.name]
			if (!mine || mine.home !== at.thread) throw new Error('Only a bot can, in its home thread')
			const name = args.name ?? at.name
			if (name !== at.name && (await bots())[name])
				throw new Error(`${name} is another bot; it changes at its own home`)
			const own = await core.agentOf(api.conversationId)
			const asked = await change({
				name,
				instructions: args.instructions,
				to: args.model ?? (name === at.name ? undefined : { ...own, name: undefined }),
			})
			const made = await core.once(`bot ${api.taskId}`, 'bot', (tx) => write(tx, at.name, asked))
			return {
				output: [
					{
						type: 'text',
						text:
							name === at.name
								? 'Done: it counts from your next request.'
								: `Made ${name}, at home in thread ${made.home}.`,
					},
				],
			}
		},
	})

	const section = {
		key: 'bot',
		render: async ({ conversationId, agent, read }) => {
			const at = await core.home(conversationId)
			const all = at && ((await read.snapshot(Bots, context)) ?? {})
			const bot = all?.[at.name]
			if (!bot) return undefined
			const threads = (await core.threadList(at.name)).filter(
				(t) => t.id !== at.thread && t.agents.some((a) => a.name === at.name),
			)
			const where = threads.map((t) => `${t.id} "${t.title}"${t.id === bot.home ? ' (home)' : ''}`)
			const home = at.thread === bot.home
			const others = Object.keys(all).filter((n) => n !== at.name)
			return [
				bot.instructions ||
					(home
						? "You're new: you have no instructions yet. Find out with the person here who you are, and write it down with your bot tool."
						: ''),
				`You are the bot ${at.name}, one person in every thread you're in.${where.length ? ` You're also in thread${where.length > 1 ? 's' : ''} ${where.join(', ')}; read one when it matters.` : ''}`,
				others.length &&
					agent.tools.some((t) => t.name === 'post') &&
					`The other bot${others.length > 1 ? 's are' : ' is'} ${others.join(', ')}: post with \`to\` set to a name to ask one.`,
				home && 'This is your home. Ask before you change your model.',
			]
				.filter(Boolean)
				.join('\n\n')
		},
	}
	return {
		serve,
		remove,
		hiding,
		recipe,
		extension: defineExtension({ name: 'agent-ide.bots', tools: [bot], sections: [section] }),
	}
}
