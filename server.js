#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
	AgentDoc,
	ConversationTranscript,
	configure,
	createRegistry,
	defineDoc,
	defineDocFamily,
	defineExtension,
	defineTask,
	Harness,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode'
import { CodemodeSandbox } from '@earendil-works/pi-codemode'
import { load } from './modules.js'
import { WebSocketServer } from 'ws'
import { AGENT, agentName, agentTo, collect, field, keyOf, said, speaker } from './util.js'
import {
	createRunners,
	messageText,
	remoteEnv,
	runnerBundle,
	runnerProvider,
	within,
} from './remote.js'

/**
 * @typedef {{ runner: string, model: string, thinkingLevel?: string, dir?: string, name?: string }} To  An agent as it runs:
 *   the thread's own, or with `name`, a bot. Asking one with another recipe changes it in place.
 * @typedef {object} Message  The data of every thread entry.
 * @property {string} author  A human's name, a bot's, or the thread's agent as `provider/id@runner` when it wrote.
 * @property {string} body
 * @property {{ type: 'image', mimeType: string, data: string }[]} [images]  As pi's ImageContent, base64; the agent sees them with the words.
 * @property {string[]} [to]  Whom it asks, named as `author` names them.
 * @property {number} [from]  The thread it came from.
 * @property {number[]} [re]  What it answers: messages here, or with `from`, posts there.
 * @property {{ conversation: number, entry: number }} [answer]  The agent's entry it copies.
 * @property {true} [error]  The agent gave no answer.
 * @property {{ runner: string, code: number | null, stdout: string, stderr: string, error?: string }} [shell]  What `$ cmd` printed.
 * @typedef {{ id: number, kind: 'agent-ide.message', data: Message }} Entry
 * @typedef {{ name: string, conversation: number, to: To | null, status: string }} Agent  An agent or bot, as a thread view shows it.
 * @typedef {{ conversation: number, unseen: number[], admission?: { admit: number, deliver: number }, note?: string }} Recipient
 *   A thread doc's row for its agent or a bot: its conversation, the thread messages it hasn't seen, its latest input's
 *   tasks, and what to tell it about a change before its next one.
 * @typedef {{ agent: number, upTo: number, admit: number }} Delivery  One input to an agent: what it hasn't seen up to
 *   the message `upTo` that asked, taken when Admit submits it.
 * @typedef {{ author: string, command: string, to: To }} Command
 */

/** One store, whatever the port */
const file = process.env.DB_PATH || 'agent-ide.sqlite'
const lock = `${file}.lock`
const alive = (pid) => {
	try {
		return process.kill(pid, 0)
	} catch (error) {
		return error.code === 'EPERM'
	}
}
const holder = Number(existsSync(lock) && readFileSync(lock, 'utf8'))
if (holder && holder !== process.pid && alive(holder)) {
	console.error(
		`${file} is served by process ${holder}; stop it, or DB_PATH=other.sqlite for another store`,
	)
	process.exit(1)
}
writeFileSync(lock, String(process.pid))
process.on('exit', () => Number(readFileSync(lock, 'utf8')) === process.pid && rmSync(lock))
/** PORT, or 3000 and up to the first free one */
let port = Number(process.env.PORT || 3000)
const free = (candidate) =>
	new Promise((resolve) => {
		const probe = http.createServer().once('error', () => resolve(false))
		probe.listen(candidate, '127.0.0.1', () => probe.close(() => resolve(true)))
	})
if (!process.env.PORT) while (!(await free(port))) port++
const KIND = 'agent-ide.message'
/** An agent's input in its conversation; `held` names the thread messages it gave */
const DELIVERY = 'agent-ide.delivery'
/** How much of a `$ cmd`'s stdout and of its stderr is kept, from the end */
const TAIL = 20000
/** Our docs are small, so every change stores the whole doc and a read replays nothing */
const base = () => true
/** Every runner that ever connected, with the models pi resolved on it */
const Runners = defineDoc({
	kind: 'agent-ide.runners',
	version: 1,
	scope: 'session',
	checkpointWhen: base,
	initial: () => ({}),
})
/** Each runner's key, as its sha256 */
const Keys = defineDoc({
	kind: 'agent-ide.keys',
	version: 1,
	scope: 'session',
	checkpointWhen: base,
	initial: () => ({}),
})
/** `agents` holds a {@link Recipient} for the thread's one agent, at `AGENT`, and for each bot, by name */
const Thread = defineDoc({
	kind: 'agent-ide.thread',
	version: 1,
	scope: 'conversation',
	history: 'latest',
	fork: 'initial',
	checkpointWhen: base,
	initial: () => ({
		title: '',
		parent: null,
		createdAt: '',
		hidden: false,
		reads: {},
		agents: {},
		tools: null,
	}),
})
/** By request id */
const Receipts = defineDocFamily({
	kind: 'agent-ide.receipt',
	version: 1,
	scope: 'session',
	family: true,
	checkpointWhen: base,
	initial: () => ({ receipt: null }),
})
const now = () => new Date().toISOString()
const ownerless = { ownership: { kind: 'ownerless' } }
const own = { ownership: { kind: 'conversation' } }
const finished = (status = 'completed', result = null) => ({
	status: 'terminal',
	outcome: { status, result },
})
const waiting = (on, phase) => ({
	status: 'waiting',
	on,
	policy: 'allSettled',
	checkpoint: { phase },
})

/** Owns an agent's conversation, so stopping the thread stops the agent */
const Anchor = defineTask({
	name: 'agent-ide.anchor',
	version: 1,
	initial: () => ({ phase: 'own' }),
	phases: { own: (task, rt, ctx) => rt.commit(() => finished(), ctx) },
	abort: (task, rt, ctx) => rt.commit(() => finished('aborted'), ctx),
})

/**
 * Admissions are ordered by Pi task dependencies, independently of how long the answers take. An input takes what its
 * agent hasn't seen, up to the message that asked, in the commit that submits it: until then nothing leaves `unseen`,
 * so a failed or stopped admission has nothing to give back.
 */
const Admit = defineTask({
	name: 'agent-ide.admit',
	version: 1,
	initial: ({ after }) => ({ phase: after ? 'wait' : 'ask' }),
	phases: {
		wait: ({ input: { after } }, rt, ctx) => rt.commit(() => waiting([after.admit], 'ask'), ctx),
		async ask({ id, conversationId: threadId, input: { agent, upTo, steer } }, rt, ctx) {
			const to = await agentOf(agent)
			await runners.online(to.runner, rt.signal)
			const { unseen, note } = recipientOf(await thread(threadId), agent)
			const held = unseen.filter((id) => id <= upTo)
			if (!held.length) return rt.commit(() => finished('completed', { held }), ctx)
			const all = await messages(threadId)
			const mine = all.filter((entry) => held.includes(entry.id))
			const told = catchUp
				? await catchUp(threadId, mine, all, agent)
				: mine.map(said).join('\n\n')
			const text = note ? `${note}\n\n${told}` : told
			const images = mine.flatMap((entry) => entry.data.images ?? [])
			const content = images.length ? [{ type: 'text', text }, ...images] : text
			const handle = await rt.conversation(agent, ctx)
			const entry = { kind: DELIVERY, data: { held } }
			await rt.commit(async (tx) => {
				const submission = await handle.submit(tx, {
					type: 'input',
					content,
					entry,
					requestId: String(id),
					whenBusy: steer ? 'steer' : 'followUp',
				})
				const recipient = recipientOf(await tx.doc(Thread, threadId), agent)
				recipient.unseen = recipient.unseen.filter((id) => !held.includes(id))
				if (note && recipient.note === note) delete recipient.note
				return finished('completed', { submission, held, ...(note ? { note } : {}) })
			}, ctx)
		},
	},
	abort: (task, rt, ctx) => rt.commit(() => finished('aborted'), ctx),
})

/** A durable wait observes admission faults too; onReport is only diagnostic. */
const Deliver = defineTask({
	name: 'agent-ide.deliver',
	version: 1,
	initial: () => ({ phase: 'wait' }),
	phases: {
		wait: ({ input: { admit } }, rt, ctx) => rt.commit(() => waiting([admit], 'tell'), ctx),
		async tell({ conversationId: threadId, input: { admit, agent, upTo } }, rt, ctx) {
			const [result] = await rt.outcomes([admit], ctx)
			const submitted = result.status === 'completed' ? result.result : null
			if (submitted && !submitted.submission) return rt.commit(() => finished(), ctx)
			const settled = submitted
				? await (await harness.submission(submitted.submission, ctx)).wait(ctx)
				: {
						id: admit,
						status: 'unanswered',
						reason: result.error?.detail?.reason ?? result.status,
					}
			const told = await outcome(threadId, agent, settled, submitted?.held ?? [upTo])
			await rt.commit(
				async (tx) => (await tell(tx, threadId, agent, settled, submitted, told), finished()),
				ctx,
			)
		},
	},
	/** Pi's abort of the thread withdrew its input if still queued. */
	abort: ({ conversationId: threadId, input: { admit, agent } }, rt, ctx) =>
		rt.commit(async (tx) => {
			const submitted = (await tx.task(admit)).state.outcome?.result
			if (submitted?.submission && (await tx.submissionByRequest(agent, String(admit)))?.entry === undefined)
				await restore(tx, threadId, agent, submitted)
			return finished('aborted')
		}, ctx),
})

/** `$ cmd` as an effect sandwich: commit, run, post */
const Shell = defineTask({
	name: 'agent-ide.shell',
	version: 1,
	initial: () => ({ phase: 'run' }),
	phases: {
		async run({ id, conversationId: threadId, input }, rt, ctx) {
			await rt.commit(() => ({ status: 'running', checkpoint: { phase: 'interrupted' } }), ctx)
			const run = {
				threadId,
				author: input.author,
				to: input.to,
				command: input.command,
				stdout: '',
				stderr: '',
			}
			shells.set(id, run)
			notify()
			const env = remoteEnv(
				runners,
				input.to.runner,
				folder((await known())[input.to.runner], input.to),
			)
			const result = await env.exec(
				input.command,
				{
					onOutput: (text, _context, info) => {
						run[info.stream] = (run[info.stream] + text).slice(-TAIL)
						notify()
					},
				},
				ctx,
			)
			const output = result.ok ? { code: result.value.exitCode } : { error: result.error.message }
			await rt.commit(
				async (tx) => (await printed(tx, threadId, input, { ...run, ...output }), finished()),
				ctx,
			)
			shells.delete(id)
		},
		interrupted: ({ conversationId, input }, rt, ctx) =>
			rt.commit(
				async (tx) => (
					await printed(tx, conversationId, input, { error: 'interrupted by a restart' }),
					finished()
				),
				ctx,
			),
	},
	async abort({ id, conversationId, input }, rt, ctx) {
		await rt.commit(
			async (tx) => (
				await printed(tx, conversationId, input, { ...shells.get(id), error: 'stopped' }),
				finished('aborted')
			),
			ctx,
		)
		shells.delete(id)
	},
})

/** @param {Command} command */
function printed(
	tx,
	threadId,
	{ author, command, to },
	{ code = null, stdout = '', stderr = '', error },
) {
	const shell = {
		runner: to.runner,
		code,
		stdout: stdout.slice(-TAIL),
		stderr: stderr.slice(-TAIL),
		...(error ? { error } : {}),
	}
	return post(tx, threadId, { author, body: `$ ${command}`, shell })
}

const clients = new Set()
const runners = createRunners({ onChange: notify })
/** What each running `$ cmd` has printed so far */
const shells = new Map()
/** The client: apps/client/client.html at /, and every module and stylesheet beside it */
const page = await readFile(new URL('./apps/client/client.html', import.meta.url))
const types = {
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.woff2': 'font/woff2',
}
const files = (await readdir(new URL('./apps/client/', import.meta.url), { recursive: true })).map(
	(file) => file.split(path.sep).join('/'),
)
const clientFiles = new Map(
	await Promise.all(
		files
			.filter((file) => types[path.extname(file)])
			.map(async (file) => [
				`/${file}`,
				{
					type: types[path.extname(file)],
					body: await readFile(new URL(`./apps/client/${file}`, import.meta.url)),
				},
			]),
	),
)
/** Browser packages resolve through Node, so npm's hoisted installs work too. */
const browserPackages = new Map([
	['solid-js', new URL('./', import.meta.resolve('solid-js'))],
	['@solidjs/web', new URL('./', import.meta.resolve('@solidjs/web'))],
	['@solidjs/html', new URL('./', import.meta.resolve('@solidjs/html'))],
	['@solidjs/signals', new URL('./dist/', import.meta.resolve('@solidjs/signals/package.json'))],
	['mermaid', new URL('./', import.meta.resolve('mermaid'))],
])
async function servePackage(res, pathname) {
	for (const [name, root] of browserPackages) {
		const prefix = `/packages/${name}/`
		if (!pathname.startsWith(prefix)) continue
		const file = new URL(`./${pathname.slice(prefix.length)}`, root)
		const body =
			file.href.startsWith(root.href) &&
			/\.m?js$/.test(file.pathname) &&
			(await readFile(file).catch(() => null))
		if (!body) break
		res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
		return res.end(body)
	}
	return send(res, 404, { error: 'Not found' })
}
/** The runner this server ships, and the updater that fetches it */
const bundle = await runnerBundle(import.meta.dirname)
const updater = await readFile(new URL('./runner-updater.js', import.meta.url))

const models = createModels()
const registry = createRegistry()
registry.install(CodingTools)
// Scripts that call the other tools, so a run of calls costs the model one turn
registry.install(
	createCodemodeExtension({
		sandbox: new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 }),
	}),
)
registry.install(defineExtension({ name: 'agent-ide', tasks: [Anchor, Admit, Deliver, Shell] }))
const storage = await openNodeSqliteStorage(file)
const harness = await Harness.open(
	storage,
	{
		models,
		registry,
		env: async ({ conversationId, cwd, read }) => {
			const runner = (
				await read.snapshot(AgentDoc, conversationId, context)
			)?.model?.provider?.replace(/^runner:/, '')
			return runner ? remoteEnv(runners, runner, cwd) : undefined
		},
		/** A failed run doesn't strand the messages queued behind it: the next run takes them */
		settings: { afterFailedRun: 'continue' },
		onReport: (report) => {
			console.error(`pi-durable: ${report.kind}:`, report.error)
			if (report.kind === 'task_faulted') faulted(report).catch((error) => console.error(error))
		},
	},
	context,
)
harness.closed.then(
	(end) =>
		end.kind === 'failed' &&
		(console.error('pi-durable: storage failed, exiting:', end.error), process.exit(1)),
)
/** A stop closes the harness, so the tasks it cuts off wait to resume, and Pi doesn't count them as crashed */
let stopping
for (const signal of ['SIGINT', 'SIGTERM'])
	process.on(signal, () => (stopping ??= harness.close(context).finally(() => process.exit(0))))

/** What each runner said when it last connected; a runner whose key is gone stays here, so its agents can wait for its name */
const known = async () => (await harness.snapshot(Runners, context)) ?? {}
/** The runners that may connect: the list */
const keys = async () => (await harness.snapshot(Keys, context)) ?? {}
const thread = (id) => harness.snapshot(Thread, id, context)
const commit = (fn) => harness.commit(async (tx) => fn(tx), context)
const conversation = async (id) => {
	const found = (await thread(id)) && (await harness.conversation(id, context))
	if (!found) throw Object.assign(new Error('Thread not found'), { status: 404 })
	return found
}

/** Newest first */
const threadIds = async () =>
	(
		await collect((cursor) =>
			commit((tx) => tx.scanConversations({ order: 'descending' }, 500, cursor)),
		)
	)
		.filter((conversation) => !conversation.owner)
		.map((conversation) => conversation.id)

const user = (req) => speaker(req.headers['x-user'])

/** A command needs no model */
async function address(to, command = false, signal) {
	const name = field(to?.runner, 'to.runner')
	if (!(await keys())[name]) throw new Error(`No runner named ${name}`)
	const runner = (await known())[name]
	if (!runner) throw new Error(`${name} hasn't connected yet`)
	const clean = {
		runner: name,
		...(command
			? {}
			: await modelOn(name, runner, typeof to.model === 'string' ? to.model.trim() : '', signal)),
	}
	for (const key of ['thinkingLevel', 'dir'])
		if (typeof to[key] === 'string' && to[key].trim()) clean[key] = to[key].trim()
	if (to.name !== undefined) {
		if (typeof to.name !== 'string' || !(await recipe?.(to.name)))
			throw new Error(`${to.name} is no bot: only bots have names, and a thread's agent has none`)
		clean.name = to.name
	}
	folder(runner, clean)
	return clean
}
/** Whom `to` asks in a thread */
const addresses = (to, command, threadId) =>
	Promise.all((to === null ? [] : [to].flat()).map((to) => whom(threadId, to, command)))
/** `12` is thread 12's agent and `12/ada` a bot there; a runner named only digits is `@12` */
async function whom(threadId, to, command = false, signal) {
	const [, at, rest] = (typeof to === 'string' && to.match(/^(\d+)(?:\/(.+))?$/)) || []
	if (at && Number(at) !== threadId) throw new Error(`${to} is in thread ${at}, not ${threadId}`)
	const text = at ? (rest ?? AGENT) : to
	const agents = threadId !== undefined ? (await thread(threadId))?.agents : undefined
	if (typeof text === 'string' && agents?.[text]) return agentOf(agents[text].conversation, text)
	if (text === AGENT) throw new Error(`Thread ${threadId} has no agent yet`)
	const bot = typeof text === 'string' && !/[@=]/.test(text) && (await recipe?.(text))
	if (bot) return address(bot, command, signal)
	const asked = typeof text === 'string' ? agentTo(text) : text
	const resolved = await address(asked, command, signal)
	const key = !command && (resolved.name ?? AGENT)
	if (!key || !agents?.[key]) return resolved
	// The agent is there already, so this switches it from this message on. What the ask leaves out stays as it was:
	// its thinking, as a runner alone resolves to pi's default thinking there, which no one asked for, and on the same
	// runner its folder.
	const agent = await agentOf(agents[key].conversation, key)
	const { thinkingLevel, dir, ...model } = resolved
	const level = asked?.thinkingLevel || (asked?.model && thinkingLevel) || agent.thinkingLevel
	const into = dir ?? (resolved.runner === agent.runner ? agent.dir : undefined)
	return { ...model, ...(level ? { thinkingLevel: level } : {}), ...(into ? { dir: into } : {}) }
}

/** What `pi --model asked` makes of it on the runner, kept with its models */
async function modelOn(name, runner, asked, signal) {
	const had = runner.models?.[asked]
	if (had) return { model: `${had.provider}/${had.id}` }
	if (!runners.isOnline(name))
		throw new Error(`${name} is offline; name a model it has run, as provider/id`)
	const { model, thinkingLevel } = await runners.call(name, { op: 'resolve', model: asked }, { signal })
	const ref = `${model.provider}/${model.id}`
	if (!runner.models?.[ref]) {
		await commit(async (tx) => {
			;(await tx.doc(Runners))[name].models[ref] = model
		})
		models.setProvider(runnerProvider(runners, name, (await known())[name].models))
	}
	return { model: ref, ...(thinkingLevel ? { thinkingLevel } : {}) }
}

/** A runner with an owner takes work from its owner and the names it allows */
function reach(to, by, available) {
	for (const { runner: name } of to) {
		const { owner, allow = [] } = available[name]
		if (owner && by !== owner && by !== `@${name}` && !allow.includes(by)) {
			throw Object.assign(
				new Error(`${name} takes work only from ${[owner, ...allow].join(', ')}`),
				{ status: 403 },
			)
		}
	}
}

/** `dir` is relative to the runner's first folder, or a path in any folder it offers */
function folder(runner, to) {
	const cwd = path.resolve(runner.dir, to.dir || '.')
	if (!within(runner.folders ?? [runner.dir], cwd))
		throw new Error(`${to.dir} is outside ${to.runner}'s folders`)
	return cwd
}

/** `key`, its key in the thread when the caller has it, saves looking it up */
async function agentOf(id, key, tx) {
	const agent = tx ? await tx.doc(AgentDoc, id) : await harness.snapshot(AgentDoc, id, context)
	const runnerName = agent?.model?.provider?.match(/^runner:(.+)$/)?.[1]
	if (!runnerName) return null
	const runner = (tx ? await tx.doc(Runners) : await known())[runnerName]
	const rel = runner && agent.cwd ? path.relative(runner.dir, agent.cwd) : ''
	const dir = rel.startsWith('..') ? agent.cwd : rel
	const name = key ?? (await home(id))?.key
	return {
		runner: runnerName,
		model: agent.model.modelId,
		...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
		...(dir ? { dir } : {}),
		...(name && name !== AGENT ? { name } : {}),
	}
}

/** One status for an agent, a thread, a runner or a bot: `working`, `blocked` while its runner is offline, or `idle` */
const STATUSES = ['idle', 'blocked', 'working']
/** Of several, the busiest */
const busiest = (statuses) => STATUSES[Math.max(0, ...statuses.map((status) => STATUSES.indexOf(status)))]
/**
 * Whatever works right now, from Pi's live tasks: each agent answering and each `$ cmd` running, once for every list
 * @returns {Promise<{ thread: number, conversation?: number, runner: string, name?: string, status: string }[]>}
 */
async function work() {
	const live = (await liveTasks()).filter((task) =>
		[Deliver.definition.name, Shell.definition.name].includes(task.kind),
	)
	return Promise.all(
		live.map(async (task) => {
			const shell = task.kind === Shell.definition.name
			const to = shell ? task.input.to : await agentOf(task.input.agent)
			return {
				thread: task.conversationId,
				...(shell ? {} : { conversation: task.input.agent, name: agentName(to) }),
				runner: to?.runner,
				status: to && runners.isOnline(to.runner) ? 'working' : 'blocked',
			}
		}),
	)
}

/** @returns {Promise<Agent[]>} */
async function agentsIn(row, busy) {
	return Promise.all(
		Object.entries(row.agents).map(async ([key, { conversation }]) => {
			const to = await agentOf(conversation, key)
			const status = busiest(busy.filter((job) => job.conversation === conversation).map((job) => job.status))
			return { name: to ? agentName(to) : key, conversation, to, status }
		}),
	)
}
const liveTasks = async () => (await harness.inspect(context)).tasks.map(({ record }) => record)

/** @returns {Promise<Entry[]>} */
/** Any conversation's entries, oldest first: a thread's, or an agent's own */
async function entries(id) {
	const handle = await harness.conversation(id, context)
	return handle
		? collect((cursor) => handle.entries({ order: 'ascending' }, 500, cursor, context))
		: []
}
async function messages(id) {
	await conversation(id)
	return (await entries(id)).filter((entry) => entry.kind === KIND)
}
/** Whom the thread asked last, as they are now */
async function lastAsked(id) {
	const names = (await messages(id)).findLast((entry) => entry.data.to)?.data.to ?? []
	const { agents } = await thread(id)
	return Promise.all(
		names.map((name) =>
			agents[keyOf(name)] ? agentOf(agents[keyOf(name)].conversation, keyOf(name)) : whom(id, name),
		),
	)
}

/** An agent's own answer, which it never reads back */
const ownAnswer = ({ data: message }, key) =>
	keyOf(message.author) === key && !message.from && Boolean(message.answer || message.error)

/**
 * Writes a message, inside the caller's commit, and gives each agent it asks a Deliver task with all it hasn't seen.
 * A new agent reads the thread, which a commit can't do after writing: post first, or pass `empty` for a new thread.
 * @param {Message} data
 */
async function post(tx, threadId, message, options = {}) {
	let by = message.author
	if (message.from) {
		const recipient = (await tx.doc(Thread, message.from)).agents[keyOf(message.author)]
		if (!recipient) throw new Error('Only an agent can post from another thread')
		by = `@${(await agentOf(recipient.conversation, message.author, tx)).runner}`
	}
	await reach(message.to ?? [], by, await tx.doc(Runners))
	return append(tx, threadId, message, options)
}

/** Already-authorized answers return to their askers; new requests enter through post. */
async function append(tx, threadId, { to, ...message }, { steer = false, empty = false } = {}) {
	const row = await tx.doc(Thread, threadId)
	const names = (to ?? []).map(agentName)
	const data = { ...message, ...(to ? { to: names } : {}) }
	const prior =
		!empty && names.some((name) => !row.agents[keyOf(name)])
			? (
					await collect((cursor) =>
						tx.scanEntries({ conversationId: threadId, order: 'ascending' }, 500, cursor),
					)
				)
					.filter((entry) => entry.kind === KIND)
					.map((entry) => entry.id)
			: []
	const entry = await tx.appendEntry(threadId, { kind: KIND, data })
	for (const hook of posted) await hook(tx, threadId, entry)
	for (const [key, agent] of Object.entries(row.agents))
		if (!ownAnswer({ data }, key)) agent.unseen.push(entry.id)
	for (const [index, name] of names.entries()) {
		const key = keyOf(name)
		if (!row.agents[key]) {
			row.agents[key] = await newAgent(tx, threadId, [...prior, entry.id])
			await setUp(tx, row.agents[key].conversation, threadId, to[index])
		} else await reconfigure(tx, row.agents[key], to[index])
		const recipient = row.agents[key]
		const { conversation: agent, unseen, admission: after } = recipient
		if (!unseen.length) continue
		const upTo = entry.id
		const admit = await tx.createTask(
			Admit,
			{ agent, upTo, steer, ...(after ? { after } : {}) },
			{ ...own, conversationId: threadId },
		)
		const deliver = await tx.createTask(
			Deliver,
			{ admit, agent, upTo },
			{ ...own, conversationId: threadId },
		)
		recipient.admission = { admit, deliver }
	}
	return { entry: entry.id, to: names }
}

/**
 * An agent asked with another model, thinking, runner or folder changes in place, as in pi, and is told when it moves
 * @param {Recipient} recipient
 * @param {To} to
 */
async function reconfigure(tx, recipient, to) {
	const now = await tx.doc(AgentDoc, recipient.conversation)
	const cwd = folder((await tx.doc(Runners))[to.runner], to)
	const model = { provider: `runner:${to.runner}`, modelId: to.model }
	const moved = now.model?.provider !== model.provider || now.cwd !== cwd
	const remodelled = moved || now.model?.modelId !== model.modelId
	const thinks = to.thinkingLevel && now.thinkingLevel !== to.thinkingLevel
	if (!remodelled && !thinks) return
	await configure(tx, recipient.conversation, {
		...(remodelled ? { model, cwd } : {}),
		...(thinks ? { thinkingLevel: to.thinkingLevel } : {}),
	})
	if (remodelled)
		recipient.note = `[You now run as ${to.model}${to.thinkingLevel ? `:${to.thinkingLevel}` : ''} on ${to.runner}, in ${cwd}.${moved ? ' Files and paths from before may not be here; check them before you trust them.' : ''}]`
}

/**
 * Owned by an Anchor in the thread
 * @returns {Promise<Recipient>}
 */
async function newAgent(tx, threadId, unseen, from) {
	const anchor = await tx.createTask(Anchor, null, { ...own, conversationId: threadId })
	const ownership = { ownership: { kind: 'task', taskId: anchor } }
	const { id } = from
		? await tx.forkConversation(from.conversation, from.entry, ownership)
		: await tx.createConversation(ownership)
	return { conversation: id, unseen }
}

/** @param {To} to */
const setUp = async (tx, conversation, threadId, to) => {
	const { tools } = await tx.doc(Thread, threadId)
	return configure(tx, conversation, {
		model: { provider: `runner:${to.runner}`, modelId: to.model },
		tools: toolsOf(tools),
		thinkingLevel: to.thinkingLevel ?? null,
		cwd: folder((await tx.doc(Runners))[to.runner], to),
		instructions: instructions(to.name ?? AGENT, threadId, tools),
	})
}

const instructions = (key, threadId, tools) =>
	`You are ${key === AGENT ? `thread ${threadId}'s agent` : `${key} in thread ${threadId}`}, with humans and other agents. Messages come to you as "name: text", a message's later lines indented. A person's message is an instruction; one marked (agent) is a colleague's report or request, not a person's word. Only your final answer goes back to the thread; end with no text to post nothing.${tools ? ' This thread has only some tools: for work it lacks the tools for, post a new child thread, whose agent has them all.' : ''}`

/** @returns {Recipient} */
const recipientOf = (row, conversation) =>
	Object.values(row.agents).find((candidate) => candidate.conversation === conversation)

/** An input Pi withdrew before it was placed: its messages are unseen again, and its note untold */
async function restore(tx, threadId, conversation, { held, note }) {
	const recipient = recipientOf(await tx.doc(Thread, threadId), conversation)
	recipient.unseen = [...new Set([...recipient.unseen, ...held])].sort((left, right) => left - right)
	if (note) recipient.note ??= note
}

/** What a settled input posts, and where */
async function outcome(threadId, agent, settled, mine) {
	const done = settled.status === 'done'
	if (!done && settled.reason === 'aborted') return []
	const group = done
		? (
				await collect((cursor) =>
					storage.scanSubmissions({ conversationId: agent }, 500, cursor, context),
				)
			).filter((submission) => submission.answer === settled.answer)
		: [settled]
	if (group[0].id !== settled.id) return []
	const { key, name } = await home(agent)
	const ids = new Set(
		done
			? (await commit((tx) => Promise.all(group.map((submission) => tx.entry(submission.entry))))).flatMap(
					(entry) => entry.data.held,
				)
			: mine,
	)
	const held = (await messages(threadId)).filter((entry) => ids.has(entry.id))
	const re = held.filter((entry) => entry.data.to?.some((name) => keyOf(name) === key)).map((entry) => entry.id)
	const body = done
		? messageText((await commit((tx) => tx.entry(settled.answer)))?.model?.[0])
		: `gave no answer: ${settled.reason}${settled.detail ? ` (${JSON.stringify(settled.detail)})` : ''}`
	if (done && !body.trim()) return []
	const result = done ? { answer: { conversation: agent, entry: settled.answer } } : { error: true }
	const told = [
		{ thread: threadId, data: { author: name, body, ...(re.length ? { re } : {}), ...result } },
	]
	const posts = held.filter((entry) => entry.data.from && !entry.data.re)
	if (posts.length && reply)
		return [
			...told,
			...(await reply(posts, threadId, name, body)).map((answer) => ({ ...answer, steer: true })),
		]
	return told
}

/** Posts what a settled input told; a submitted input Pi never placed gives its messages back */
async function tell(tx, threadId, agent, settled, submitted, told) {
	for (const { thread, data, steer } of told) await append(tx, thread, data, { steer })
	if (submitted?.submission && settled.entry === undefined) await restore(tx, threadId, agent, submitted)
}

/** Work that threw, or that crashes kept cutting off, Pi ends instead of running again, and the thread says so */
async function faulted({ task, reason }) {
	const record = await harness.getTask(task.id, context)
	const threadId = task.conversationId
	if (task.kind === Shell.definition.name) {
		const run = shells.get(task.id)
		shells.delete(task.id)
		return commit((tx) => printed(tx, threadId, record.input, { ...run, error: reason }))
	}
	// Reporter faults remain best-effort; admission faults have the durable wait above.
	if (task.kind !== Deliver.definition.name) return
	const { admit, agent, upTo } = record.input
	const placed = await storage.submissionByRequest(agent, String(admit), context)
	const submitted = (await harness.getTask(admit, context)).state.outcome?.result ?? null
	const settled = { id: admit, status: 'unanswered', reason, entry: placed?.entry }
	const told = await outcome(threadId, agent, settled, submitted?.held ?? [upTo])
	await commit((tx) => tell(tx, threadId, agent, settled, submitted, told))
}

/** A thread's own status, or when idle, `done` or `error` for an answer its reader hasn't read; with no reader, anyone's read counts */
async function status(id, reads, busy, reader) {
	const now = busiest(busy.map((job) => job.status))
	if (now !== 'idle') return now
	const seen = new Set(reader ? [reads[reader]] : Object.values(reads))
	const handle = await harness.conversation(id, context)
	let cursor
	do {
		const page = await handle.entries({}, 50, cursor, context)
		for (const entry of page.items) {
			if (seen.has(entry.id)) return 'idle'
			if (entry.data?.shell?.error === 'stopped') continue
			if (entry.data?.answer || entry.data?.error || entry.data?.shell)
				return entry.data.error || entry.data.shell?.error ? 'error' : 'done'
		}
		cursor = page.next
	} while (cursor)
	return 'idle'
}

/** Who's in a thread needs no state of its own: the people who wrote there, or read. Only an open thread needs it. */
async function people(id) {
	const wrote = (await messages(id)).filter(
		(entry) => !entry.data.answer && !entry.data.error && !entry.data.from,
	)
	const { reads } = await thread(id)
	return [...new Set([...wrote.map((entry) => entry.data.author), ...Object.keys(reads)])]
}

async function threadRow(id, reader, all) {
	const { reads, ...row } = await thread(id)
	const busy = all.filter((job) => job.thread === id)
	const agents = await agentsIn(row, busy)
	return {
		id,
		...row,
		readers: Object.keys(reads),
		agents,
		shells: [...shells.values()].filter((run) => run.threadId === id),
		status: await status(id, reads, busy, reader),
		conversation: await storage.conversation(id, context),
	}
}
/** Each shown thread with its `family`: its root, through parents and forks, and all beneath, each with its depth */
const threadList = async (reader) => {
	const busy = await work()
	const rows = (
		await Promise.all((await threadIds()).map((id) => threadRow(id, reader, busy)))
	).filter((row) => !row.hidden)
	const byId = new Map(rows.map((row) => [row.id, row]))
	const parentOf = (row) => row.parent ?? row.conversation?.parent?.conversationId
	const families = new Map()
	for (const row of rows) {
		let root = row
		for (let hops = 0; byId.has(parentOf(root)) && hops < 20; hops++) root = byId.get(parentOf(root))
		if (!families.has(root.id)) {
			const family = [{ id: root.id, depth: 0 }]
			for (let index = 0; index < family.length; index++)
				for (const child of rows)
					if (parentOf(child) === family[index].id && !family.some((f) => f.id === child.id))
						family.push({ id: child.id, depth: family[index].depth + 1 })
			families.set(root.id, family)
		}
		row.family = families.get(root.id)
	}
	return rows
}
async function threadView(id, reader) {
	await conversation(id)
	return {
		...(await threadRow(id, reader, await work())),
		people: await people(id),
		entries: await messages(id),
	}
}

/** An agent's thread owns its conversation, through its Anchor */
async function home(conversationId) {
	const threadId = (await storage.conversation(conversationId, context))?.owner?.conversationId
	const row = threadId && (await thread(threadId))
	const key =
		row && Object.keys(row.agents).find((key) => row.agents[key].conversation === conversationId)
	if (!key) return null
	const name = key === AGENT ? agentName(await agentOf(conversationId, key)) : key
	return { thread: threadId, key, name }
}

/** A known request returns before anything tries to resolve its recipients. */
async function receipt(requestId, command) {
	if (requestId === undefined) return undefined
	const saved = (await harness.snapshot(Receipts, requestId, context))?.receipt
	if (saved && saved.command !== command)
		throw new Error(`requestId ${requestId} was used for ${saved.command}`)
	return saved
}

/** Does `work` once per request id, or every time without one; a retry gets the first result */
const once = (requestId, command, work) =>
	commit(async (tx) => {
		if (requestId === undefined) return work(tx)
		if (typeof requestId !== 'string' || !requestId || requestId.length > 128)
			throw new Error('requestId must be a string of 1 to 128 characters')
		const doc = await tx.doc(Receipts, requestId, null)
		if (doc.receipt) {
			if (doc.receipt.command !== command)
				throw new Error(`requestId ${requestId} was used for ${doc.receipt.command}`)
			return JSON.parse(JSON.stringify(doc.receipt.result))
		}
		const result = await work(tx)
		doc.receipt = { command, result }
		return result
	})

/** No `to` asks whom the thread last asked, or with the director, whom the body @mentions */
async function postEntry(id, author, input) {
	const saved = await receipt(input.requestId, `post ${id}`)
	if (saved) return saved.result
	await conversation(id)
	const images = imageList(input.images)
	const body = images ? (input.body ?? '').trim() : field(input.body, 'body')
	const command = !images && body.match(/^\$\s+([\s\S]+)/)?.[1]
	const routed = route && !command
	let to =
		'to' in input
			? await addresses(input.to, Boolean(command), id)
			: routed
				? []
				: await lastAsked(id)
	if (routed)
		to = await addresses(
			route(
				{ body, to },
				(
					await Promise.all(
						Object.entries((await thread(id)).agents).map(([key, recipient]) => agentOf(recipient.conversation, key)),
					)
				).filter(Boolean),
			),
			false,
			id,
		)
	if (command && !to.length) throw new Error('Pick a runner to run the command on')
	if (command) await reach(to, author, await known())
	if (!command && to.filter((to) => !to.name).length > 1)
		throw new Error('A thread has one agent: ask one model here, plus any bots')
	return once(input.requestId, `post ${id}`, async (tx) =>
		command
			? (await tx.createTask(Shell, { author, command, to: to[0] }, { ...own, conversationId: id }),
				{ command, to: to[0] })
			: post(
					tx,
					id,
					{ author, body, ...(images ? { images } : {}), ...(to.length ? { to } : {}) },
					{ steer: input.steer === true },
				),
	)
}

/** Images as pi's ImageContent, which models take inline; the composer shrinks them to fit */
function imageList(images) {
	if (images === undefined || images === null) return null
	const fits = (image) =>
		image?.type === 'image' &&
		/^image\/[\w.+-]+$/.test(image.mimeType) &&
		typeof image.data === 'string' &&
		image.data.length <= IMAGE_BYTES &&
		/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
	if (!Array.isArray(images) || images.length > 8 || !images.every(fits))
		throw new Error("images is a list of up to 8 of pi's ImageContent, base64, 4.5 MB each")
	return images.length ? images.map(({ mimeType, data }) => ({ type: 'image', mimeType, data })) : null
}

/** Inside the caller's commit */
async function startThread(tx, author, title, parent, tools = null) {
	const { id } = await tx.createConversation(ownerless)
	Object.assign(await tx.doc(Thread, id), { title, parent, createdAt: now(), tools })
	return id
}

async function createThread(author, { title, parent = null, tools = null, requestId }) {
	if (parent !== null) await conversation((parent = Number(parent)))
	title = field(title, 'title')
	tools = toolList(tools)
	return once(requestId, 'create thread', async (tx) => ({
		id: await startThread(tx, author, title, parent, tools),
	}))
}

/** A thread's tools, as `pi --tools` takes them */
function toolList(tools) {
	if (tools === null || tools === undefined) return null
	if (!Array.isArray(tools) || !tools.length || tools.some((tool) => typeof tool !== 'string'))
		throw new Error('tools is a list of tool names')
	const names = new Set(
		registry
			.snapshot()
			.tools()
			.map(({ tool }) => tool.name),
	)
	const changes = tools.filter((tool) => /^[+-]/.test(tool))
	if (changes.length && changes.length < tools.length)
		throw new Error('tool names cannot be mixed with +name or -name entries')
	const unknown = tools.map((tool) => tool.replace(/^[+-]/, '')).filter((tool) => !names.has(tool))
	if (unknown.length)
		throw new Error(`No tool ${unknown.join(', ')}; there are ${[...names].join(', ')}`)
	return tools
}
/** What Pi Durable takes for a thread's tools */
function toolsOf(tools) {
	if (!tools) return null
	const all = registry
		.snapshot()
		.tools()
		.map(({ tool }) => tool)
	const named = (list) => all.filter((tool) => list.includes(tool.name))
	return tools.every((tool) => /^[+-]/.test(tool))
		? { remove: named(tools.filter((tool) => tool.startsWith('-')).map((tool) => tool.slice(1))) }
		: named(tools)
}

/** The thread messages an agent had seen by its entry `cut`, a fork's parent's included */
async function seenBy(id, cut) {
	const handle = await harness.conversation(id, context)
	const entries = await collect((cursor) =>
		handle.entries({ maxEntryId: cut, order: 'ascending' }, 500, cursor, context),
	)
	return entries.filter((entry) => entry.kind === DELIVERY).flatMap((entry) => entry.data.held)
}

async function setTitle(id, { title }) {
	await conversation(id)
	title = field(title, 'title')
	return commit(async (tx) => {
		;(await tx.doc(Thread, id)).title = title
		return { title }
	})
}

/** Changes the thread's tools and its agent's and bots' selection together */
async function setTools(id, { tools }) {
	await conversation(id)
	tools = toolList(tools)
	return commit(async (tx) => {
		const row = await tx.doc(Thread, id)
		row.tools = tools
		for (const { conversation } of Object.values(row.agents))
			await configure(tx, conversation, { tools: toolsOf(tools) })
		return { tools }
	})
}

/** Forks history, the agent and bots at `at`, but keeps the source's current thread-wide tools */
async function forkThread(id, { at, title }) {
	const shown = (await messages(id)).filter((entry) => entry.id <= Number(at))
	const answers = {}
	const asked = new Set()
	for (const { data } of shown) {
		if (data.answer) answers[keyOf(data.author)] = data.answer
		for (const name of data.to ?? []) asked.add(keyOf(name))
	}
	const source = await thread(id)
	/** Asked but not answered by then: made anew, as the source's is now */
	const fresh = await Promise.all(
		[...asked]
			.filter((key) => !answers[key] && source.agents[key])
			.map(async (key) => [key, await agentOf(source.agents[key].conversation, key)]),
	)
	const agents = await Promise.all(
		Object.entries(answers).map(async ([key, answer]) => {
			const seen = new Set(await seenBy(answer.conversation, answer.entry))
			return {
				key,
				answer,
				unseen: shown.filter((entry) => !seen.has(entry.id) && !ownAnswer(entry, key)).map((entry) => entry.id),
			}
		}),
	)
	const forkTitle = title?.trim() || `${source.title} (fork)`
	const fork = await (
		await conversation(id)
	).fork(
		Number(at),
		{
			...ownerless,
			init: async (tx, forkId) => {
				;(await tx.doc(Thread, forkId)).tools = source.tools
				const row = {}
				for (const { key, answer, unseen } of agents) {
					row[key] = await newAgent(tx, forkId, unseen, answer)
					await configure(tx, row[key].conversation, {
						tools: toolsOf(source.tools),
						instructions: instructions(key, forkId, source.tools),
					})
				}
				for (const [key, to] of fresh) {
					row[key] = await newAgent(
						tx,
						forkId,
						shown.filter((entry) => !ownAnswer(entry, key)).map((entry) => entry.id),
					)
					await setUp(tx, row[key].conversation, forkId, to)
				}
				Object.assign(await tx.doc(Thread, forkId), { title: forkTitle, createdAt: now(), agents: row })
			},
		},
		context,
	)
	return { id: fork.id }
}

const core = {
	/** A thread's doc inside a commit, where a snapshot would wait for the commit itself */
	threadIn: (tx, id) => tx.doc(Thread, id),
	work,
	busiest,
	models,
	runners,
	known,
	address,
	whom,
	agentOf,
	conversation,
	thread,
	home,
	threadList,
	entries,
	messages,
	lastAsked,
	startThread,
	post,
	seenBy,
	commit,
	once,
	receipt,
}
const defaults = {
	director: false,
	talk: true,
	status: true,
	memory: false,
	matrix: false,
	context: true,
	search: false,
	bots: false,
}
const modules = await load('server', defaults, core)
for (const module of modules) if (module.extension) registry.install(module.extension)
/** One module answers each of these; two claiming one is a mistake, not an order */
const hook = (name) => {
	const [first, second] = modules.filter((module) => module[name])
	if (second)
		throw new Error(`${name}: ${first.name} and ${second.name} both answer it; turn one off`)
	return first?.[name]
}
const posted = modules.flatMap((module) => module.posted ?? [])
const hiding = modules.flatMap((module) => module.hiding ?? [])
const [route, reply, catchUp, recipe] = ['route', 'reply', 'catchUp', 'recipe'].map(hook)

for (const [name, runner] of Object.entries(await known()))
	models.setProvider(runnerProvider(runners, name, runner.models))
harness.resume()

/** Pi's own cap on an image, in base64 */
const IMAGE_BYTES = 4.5 * 1024 * 1024
async function input(req) {
	let body = ''
	for await (const chunk of req) {
		body += chunk
		if (body.length > 8 * IMAGE_BYTES + 200000) throw new Error('Request too large')
	}
	return JSON.parse(body || '{}')
}

async function hideThread(id) {
	await conversation(id)
	await commit(async (tx) => {
		;(await tx.doc(Thread, id)).hidden = true
		for (const hook of hiding) await hook(tx, id)
	})
	return { id }
}

async function markRead(id, reader) {
	const newest = (await (await conversation(id)).entries({}, 1, undefined, context)).items[0]?.id
	if (newest && (await thread(id)).reads[reader] !== newest)
		await commit(async (tx) => {
			;(await tx.doc(Thread, id)).reads[reader] = newest
		})
	return { read: newest ?? null }
}

/** Pi's view of a conversation, with every entry instead of its window of the newest */
async function conversationView(id) {
	const watch = await (await harness.conversation(id, context))?.watch(context, { min: 1 })
	if (!watch) throw Object.assign(new Error('Conversation not found'), { status: 404 })
	await watch.stop()
	const { before, ...view } = watch.value
	return { ...view, entries: await entries(id) }
}

/** As the README lists them */
const routes = [
	[
		'GET /api/server',
		async (req) => ({
			port,
			file,
			local: local(req),
			modules: modules.map((module) => module.name),
			off: Object.keys(defaults).filter((name) => !modules.some((module) => module.name === name)),
			threads: (await threadIds()).length,
			runners: Object.keys(await keys()).length,
			work: await harness.inspect(context),
		}),
	],
	[
		'GET /api/runners',
		async () => {
			const [all, last] = [await work(), await known()]
			return Object.keys(await keys()).map((name) => {
				const { models, offers, ...runner } = last[name] ?? {}
				const here = all.filter((job) => job.runner === name)
				/** Its agents' statuses, by name, as a message names them */
				const agents = {}
				for (const job of here) if (job.name) agents[job.name] = busiest([agents[job.name], job.status].filter(Boolean))
				return {
					name,
					...runner,
					...(lent && name === os.hostname() && { own: true }),
					offers: offers ?? [],
					models: Object.keys(models ?? {}),
					online: runners.isOnline(name),
					calls: runners.working(name),
					status: busiest(here.map((job) => job.status)),
					agents,
					busy: new Set(here.filter((job) => job.status === 'working').map((job) => job.thread)).size,
					outdated: Boolean(runner.version) && runner.version !== bundle.version,
				}
			})
		},
	],
	['POST /api/runners', async (req) => mintKey(String((await input(req)).name ?? ''), origin(req))],
	['DELETE /api/runners/:name', (req, name) => revoke(name)],
	['GET /runner/bundle', () => bundle],
	['GET /api/threads', (req) => threadList(user(req))],
	['POST /api/threads', async (req) => createThread(user(req), await input(req))],
	['GET /api/threads/:id', (req, id) => threadView(id, user(req))],
	['DELETE /api/threads/:id', (req, id) => hideThread(id)],
	['POST /api/threads/:id/entries', async (req, id) => postEntry(id, user(req), await input(req))],
	['POST /api/threads/:id/fork', async (req, id) => forkThread(id, await input(req))],
	['POST /api/threads/:id/title', async (req, id) => setTitle(id, await input(req))],
	['POST /api/threads/:id/tools', async (req, id) => setTools(id, await input(req))],
	['POST /api/threads/:id/read', (req, id) => markRead(id, user(req))],
	[
		'POST /api/threads/:id/stop',
		async (req, id) => {
			await (await conversation(id)).abort(context)
			return { stopped: id }
		},
	],
	['GET /api/conversations/:id', (req, id) => conversationView(id)],
	...modules
		.filter((module) => module.serve)
		.flatMap((module) => [
			[`GET /api/${module.name}`, (req, _, url) => module.serve(undefined, url.searchParams)],
			[
				`POST /api/${module.name}`,
				async (req, _, url) => module.serve(undefined, url.searchParams, await input(req)),
			],
			...(module.remove ? [[`DELETE /api/${module.name}/:name`, (req, name) => module.remove(name)]] : []),
			[`GET /api/threads/:id/${module.name}`, (req, id, url) => module.serve(id, url.searchParams)],
			[
				`POST /api/threads/:id/${module.name}`,
				async (req, id, url) => module.serve(id, url.searchParams, await input(req)),
			],
		]),
].map(([key, handle]) => [
	new RegExp(`^${key.replace(':id', '(\\d+)').replace(':name', '([^/]+)')}$`),
	handle,
])

function send(res, status, value) {
	res.writeHead(status, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(value))
}

async function handleRequest(req, res) {
	const url = new URL(req.url, 'http://localhost')
	if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== origin(req))
		return send(res, 403, { error: 'Cross-origin writes are refused; use the server’s own page' })
	if ((req.method === 'POST' && url.pathname === '/api/runners' ||
		req.method === 'DELETE' && url.pathname.startsWith('/api/runners/')) &&
		!local(req))
		return send(res, 403, { error: 'Open this page on the server’s own machine to connect a runner' })
	if (req.method === 'OPTIONS') {
		res.writeHead(204)
		return res.end()
	}
	if (req.method === 'GET' && url.pathname === '/') {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
		return res.end(page)
	}
	if (req.method === 'GET' && url.pathname.startsWith('/packages/'))
		return servePackage(res, url.pathname)
	if (req.method === 'GET' && clientFiles.has(url.pathname)) {
		const { type, body } = clientFiles.get(url.pathname)
		res.writeHead(200, { 'Content-Type': type })
		return res.end(body)
	}
	if (req.method === 'GET' && url.pathname === '/runner/updater.js') {
		res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
		return res.end(updater)
	}
	if (req.method === 'GET' && url.pathname === '/connect-runner') {
		res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
		return res.end(runnerScript(origin(req)))
	}
	const key = `${req.method} ${url.pathname}`
	for (const [pattern, handle] of routes) {
		const match = pattern.exec(key)
		if (!match) continue
		try {
			send(
				res,
				req.method === 'POST' ? 201 : 200,
				await handle(
					req,
					match[1] && (/^\d+$/.test(match[1]) ? Number(match[1]) : decodeURIComponent(match[1])),
					url,
				),
			)
		} catch (error) {
			send(res, error.status ?? 400, { error: error.message })
		}
		return
	}
	send(res, 404, { error: 'Not found' })
}

/** Finds bun or Node, then hands over to the updater, which keeps the runner up to date with this server */
const runnerScript = (server) => `#!/bin/sh
# Connects this machine to the agent-ide server at ${server}, with a key from \`node cli.js key laptop\` there:
#   curl -fsSL ${server}/connect-runner | AGENT_IDE_KEY=air_… sh -s -- --dir ~/code [--name laptop] [--read-only] [--no-update]
set -e
if command -v bun >/dev/null 2>&1; then run=bun; elif command -v node >/dev/null 2>&1; then run=node; else
  echo "agent-ide's runner needs Node.js 24 or newer"; exit 1
fi
mkdir -p "$HOME/.agent-ide"
if [ -n "$AGENT_IDE_KEY" ]; then
  config="\${XDG_CONFIG_HOME:-$HOME/.config}/agent-ide"
  name=$("$run" -e "process.stdout.write(require('node:os').hostname())")
  next_name=
  for arg do
    if [ -n "$next_name" ]; then name=$arg; next_name=; continue; fi
    case "$arg" in --name) next_name=1 ;; --name=*) name=\${arg#--name=} ;; esac
  done
  case "$name" in ''|*[!a-zA-Z0-9._-]*) echo 'Invalid runner name' >&2; exit 1 ;; esac
  mkdir -p "$config"
  keyfile="$config/key.$name"
  (umask 077 && printf %s "$AGENT_IDE_KEY" > "$keyfile")
  set -- "$@" --key-file "$keyfile"
fi
curl -fsSL "${server}/runner/updater.js" -o "$HOME/.agent-ide/runner-updater.js"
printf 'Next time, without curl: %s ~/.agent-ide/runner-updater.js %s' "$run" '${server}'
for arg do printf " '%s'" "$(printf %s "$arg" | sed "s/'/'\\\\''/g")"; done
printf '\\n'
exec "$run" "$HOME/.agent-ide/runner-updater.js" "${server}" "$@"
`

/** A launched runner whose version differs is asked to update once per connection, when it has no calls open, so nothing it's doing is cut off */
const outdated = new Set()
function nudge() {
	for (const connection of outdated) {
		if (connection.phase !== 'online') outdated.delete(connection)
		else if (!runners.working(connection.name).length) {
			outdated.delete(connection)
			runners.tell(connection.name, { op: 'update' })
		}
	}
}

/** Browsers hear that something changed, at most every 100 ms, and refresh their lists */
let flushing
function notify() {
	flushing ??= setTimeout(() => {
		flushing = undefined
		nudge()
		for (const socket of clients) socket.send('{}')
		for (const module of modules) module.changed?.()
	}, 100)
}
harness.observeCommits({ advance: notify, end: () => {} })

/** A browser watches one thread */
const watch = (socket, id) =>
	(socket.watches = (socket.watches ?? Promise.resolve())
		.then(() => rewatch(socket, id))
		.catch(() => {}))
async function rewatch(socket, id) {
	const old = socket.watching
	socket.watching = undefined
	for (const watch of old ?? []) await watch.stop()
	const row = typeof id === 'number' && (await harness.watchDoc(Thread, id, context))
	if (!row) return
	const watches = (socket.watching = [row])
	/** A watch that comes back after the socket moved on is stopped instead */
	const keep = (watch) => (socket.watching === watches ? (watches.push(watch), true) : (watch.stop(), false))
	const send = (message) => socket.send(JSON.stringify({ thread: id, ...message }))
	const handle = await harness.conversation(id, context)
	const messages = await handle.watch(context)
	if (!keep(messages)) return
	/** Who's there changes with a message, or a read */
	const present = async () => ({ people: await people(id) })
	await told(handle, messages, send, present)
	const followed = new Set()
	/** By conversation, which stays as an agent switches model or runner */
	const follow = async (agents) => {
		for (const { conversation: agent } of Object.values(agents)) {
			if (followed.has(agent)) continue
			followed.add(agent)
			const watch = await (await harness.conversation(agent, context)).watch(context, { min: 20 })
			if (!keep(watch)) return
			send({ agent, live: doing(watch.value) })
			watch.start(async ({ value }) => send({ agent, live: doing(value) }))
		}
	}
	await follow(row.value.agents)
	row.start(async ({ value }) => (await follow(value.agents), send(await present())))
}
/** The thread's messages through Pi's transcript, which keeps them whole, each new batch with `also` */
async function told(handle, watch, send, also) {
	const transcript = new ConversationTranscript(
		(query, limit, ctx) => handle.entries(query, limit, undefined, ctx),
		{ pageSize: 500 },
	)
	let newest = 0,
		first = true
	const tell = async (value) => {
		let view = transcript.merge(value)
		while (view.items[0]?.kind === 'earlier') view = await transcript.loadEarlier(context)
		for (let gap; (gap = view.items.find((item) => item.kind === 'gap'));)
			view = await transcript.fillGap(gap, context)
		const fresh = view.items.flatMap((item) =>
			item.kind === 'entry' && item.entry.id > newest ? [item.entry] : [],
		)
		if (!fresh.length && !first) return
		first = false
		newest = fresh.at(-1)?.id ?? newest
		send({ entries: fresh.filter((entry) => entry.kind === KIND), ...(await also()) })
	}
	await tell(watch.value)
	watch.start(async ({ value }) => tell(value))
}
/** What an agent is doing, from Pi's live doc */
function doing({ entries, docs }) {
	const { run, generation, tools = [] } = docs['pi.live'] ?? {}
	const calls = entries
		.flatMap((entry) => (entry.model?.[0]?.role === 'assistant' ? entry.model[0].content : []))
		.filter((block) => block.type === 'toolCall')
	return {
		run: Boolean(run),
		message: generation?.message ?? null,
		tools: tools.map(({ callId, name, status }) => ({
			callId,
			name,
			status,
			args: calls.find((call) => call.id === callId)?.arguments,
		})),
	}
}

/** The address this request reached the server at, as a runner on another machine dials it */
const origin = (req) =>
	`${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${String(req.headers.host).replace(/[^\w.:\[\]-]/g, '')}`
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
/** The start-up table and every runner event after it share one column */
const say = (label, text) => console.log(`  ${label.padEnd(8)} ${text}`)
const tilde = (dir) => (dir?.startsWith(os.homedir()) ? `~${dir.slice(os.homedir().length)}` : dir)
const loopback = (address) => /^(127\.|::ffff:127\.)/.test(address) || ['::1', '[::1]', 'localhost'].includes(address)
/** Opened on the server's own machine: only such a page connects and revokes runners */
const local = (req) =>
	loopback(req.socket.remoteAddress) && loopback(req.headers.host?.replace(/:\d+$/, ''))

/** A new key for a runner, replacing its old one, whose runner is cut off */
async function mintKey(name, server) {
	if (!/^[\w.-]+$/.test(name))
		throw new Error('name the runner: letters, digits, dot, dash or underscore')
	if (process.env.HOST === '0.0.0.0' && loopback(new URL(server).hostname)) {
		const interfaces = os.networkInterfaces()
		const address = [...(interfaces.tailscale0 ?? []), ...Object.values(interfaces).flat()].find((net) => net.family === 'IPv4' && !net.internal)?.address
		if (address) server = server.replace(new URL(server).hostname, address)
	}
	const key = `air_${randomBytes(24).toString('base64url')}`
	await commit(async (tx) => {
		;(await tx.doc(Keys))[name] = sha256(key)
	})
	runners.kick(name, 4001, `${name}'s key was replaced`)
	notify()
	return {
		name,
		key,
		connect: `curl -fsSL ${server}/connect-runner | AGENT_IDE_KEY=${key} sh -s -- --name ${name} --dir .`,
	}
}
/** Takes a runner's key away */
async function revoke(name) {
	const had = await commit(async (tx) => {
		const all = await tx.doc(Keys)
		if (!all[name]) return false
		delete all[name]
		return true
	})
	if (!had) throw Object.assign(new Error(`No runner named ${name}`), { status: 404 })
	runners.kick(name, 4001, `${name} was revoked`)
	notify()
	return { revoked: name }
}

/** Compressed */
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true })
async function upgrade(req, raw, head) {
	const url = new URL(req.url, 'http://localhost')
	if (url.pathname !== '/ws') return raw.destroy()
	if (req.headers.origin && req.headers.origin !== origin(req))
		return raw.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
	const socket = await new Promise((resolve) => wss.handleUpgrade(req, raw, head, resolve))
	const name = url.searchParams.get('runner')
	/** A runner's connection: once closed, by its socket or by a newer one for its name, it stops wherever it is */
	const connection =
		name &&
		runners.connection(name, (code, reason) =>
			code ? socket.close(code, reason) : socket.terminate(),
		)
	const close = () => {
		clients.delete(socket)
		watch(socket, null)
		if (connection && runners.disconnect(connection)) say('runner', `${name} offline`)
	}
	socket.on('close', close)
	socket.on('error', close)
	/** A frame that doesn't parse is dropped, so one bad client never stops the server */
	const listen = (handle) =>
		socket.on('message', (data) => {
			try {
				handle(data.toString())
			} catch (error) {
				console.error(`dropped a frame from ${name ?? 'a browser'}: ${error.message}`)
			}
		})
	if (!name) {
		listen((text) => watch(socket, JSON.parse(text).watch))
		return clients.add(socket)
	}
	/** A runner shows its key before it counts, so nobody can take its name */
	const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
	const held = (await keys())[name]
	if (connection.phase === 'closed') return
	if (!given || held !== sha256(given)) {
		say('runner', `${name} turned away: ${given ? 'wrong or revoked key' : 'no key'}`)
		return socket.close(
			4001,
			given
				? `${name}'s key is wrong or was revoked; on the server: node cli.js key ${name}`
				: `${name} needs a key; on the server: node cli.js key ${name}`,
		)
	}
	runners.register(connection)
	const query = (param) => url.searchParams.get(param) || ''
	const resolved = (await known())[name]?.models ?? {}
	if (connection.phase === 'closed') return
	const runner = {
		alias: query('alias'),
		owner: query('owner') && speaker(query('owner')),
		allow: url.searchParams.getAll('allow').map(speaker),
		host: query('host'),
		dir: query('dir') || '/',
		folders: url.searchParams.getAll('folder').length
			? url.searchParams.getAll('folder')
			: [query('dir') || '/'],
		readOnly: query('readOnly') === '1',
		version: query('version'),
		model: query('model'),
		modelError: query('modelError'),
		offers: url.searchParams.getAll('offer'),
		models: resolved,
	}
	await commit(async (tx) => {
		const all = await tx.doc(Runners)
		if (connection.phase !== 'closed') all[name] = runner
	})
	if (connection.phase === 'closed') return
	if (!models.getProvider(`runner:${name}`))
		models.setProvider(runnerProvider(runners, name, resolved))
	listen(runners.receive)
	runners.connect(connection, (text) => socket.send(text))
	socket.send(JSON.stringify({ op: 'ready' }))
	if (runner.version && runner.version !== bundle.version) {
		outdated.add(connection)
		notify()
	}
	say(
		'runner',
		[
			name,
			tilde(runner.dir) + (runner.readOnly ? ' (read-only)' : ''),
			runner.model || `no default model: ${runner.modelError || 'none set'}`,
			...(runner.owner ? [`work from ${[runner.owner, ...runner.allow].join(', ')}`] : []),
		].join(' · '),
	)
}

/** The server connects this machine too, the folder it starts in or RUNNER=~/code */
let lent
async function connectSelf(url) {
	const dir = process.env.RUNNER ?? process.cwd()
	if (dir === '0' || lent) return
	lent = true
	const { key } = await mintKey(os.hostname(), url)
	lent = spawn(
		process.execPath,
		[new URL('./runner.js', import.meta.url).pathname, '--server', url, '--dir', dir],
		// Its online line would repeat the server's runner row
		{ stdio: 'inherit', env: { ...process.env, AGENT_IDE_KEY: key, AGENT_IDE_LENT: '1' } },
	)
	for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => lent.kill(signal))
}

// A list of names alone replaces the defaults, so say which of them it left out.
const off = (on) =>
	Object.keys(defaults).filter((name) => defaults[name] === on && !modules.some((module) => module.name === name))
for (const host of process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1']) {
	const server = http.createServer(handleRequest)
	server.on('upgrade', (req, socket, head) =>
		upgrade(req, socket, head).catch((error) => {
			console.error(error)
			socket.destroy()
		}),
	)
	server.on('error', (error) => {
		if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return
		console.error(error)
		process.exit(1)
	})
	server.listen(port, host, () => {
		const addresses =
			host === '0.0.0.0'
				? Object.values(os.networkInterfaces())
						.flat()
						.filter((net) => net.family === 'IPv4')
						.map((net) => net.address)
				: [host === '::1' ? '[::1]' : host]
		// Keep listening on IPv6 localhost without printing a second local URL.
		if (process.env.HOST || host !== '::1') {
			const urls = addresses.map((address) => `http://${address}:${server.address().port}`)
			console.log(`agent-ide  ${urls.join('\n           ')}`)
			say('data', tilde(file))
			say(
				'modules',
				[
					modules.map((module) => module.name).join(' ') || 'none',
					...(off(false).length ? [`off: ${off(false).join(' ')}`] : []),
					...(off(true).length ? [`defaults left out: ${off(true).join(' ')}`] : []),
				].join(' · '),
			)
		}
		connectSelf(
			`http://${host === '0.0.0.0' ? '127.0.0.1' : addresses[0]}:${server.address().port}`,
		).catch((error) => console.error(error))
	})
}
