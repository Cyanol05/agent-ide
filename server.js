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
import { agentName, agentTo, collect, field, said, speaker } from './util.js'
import {
	createRunners,
	messageText,
	remoteEnv,
	runnerBundle,
	runnerProvider,
	within,
} from './remote.js'

/**
 * @typedef {{ runner: string, model: string, thinkingLevel?: string, dir?: string, name?: string }} To  An agent: its name in
 *   the thread, `provider/id@runner` unless `name` gives another; the rest is the recipe it runs on.
 * @typedef {object} Message  The data of every thread entry.
 * @property {string} author  A human's name, or an agent's.
 * @property {string} body
 * @property {string[]} [to]  The names of the agents it asks.
 * @property {number} [from]  The thread it came from.
 * @property {number[]} [re]  What it answers: messages here, or with `from`, posts there.
 * @property {{ conversation: number, entry: number }} [answer]  The agent's entry it copies.
 * @property {true} [error]  The agent gave no answer.
 * @property {{ runner: string, code: number | null, stdout: string, stderr: string, error?: string }} [shell]  What `$ cmd` printed.
 * @typedef {{ id: number, kind: 'agent-ide.message', data: Message }} Entry
 * @typedef {{ name: string, conversation: number, to: To | null, status: string }} Agent
 * @typedef {{ agent: number, held: number[], admit: number }} Delivery  The thread messages one input to an agent holds.
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
const free = (p) =>
	new Promise((resolve) => {
		const probe = http.createServer().once('error', () => resolve(false))
		probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true)))
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
/** `agents` */
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

/** Admissions are ordered by Pi task dependencies, independently of how long the answers take. */
const Admit = defineTask({
	name: 'agent-ide.admit',
	version: 1,
	initial: ({ after }) => ({ phase: after ? 'wait' : 'ask' }),
	phases: {
		wait: ({ input: { after } }, rt, ctx) =>
			rt.commit(() => waiting([after.admit], 'previous'), ctx),
		async previous({ input: { after } }, rt, ctx) {
			const [outcome] = await rt.outcomes([after.admit], ctx)
			await rt.commit(
				() =>
					outcome.status === 'completed'
						? { status: 'running', checkpoint: { phase: 'ask' } }
						: waiting([after.deliver], 'reclaim'),
				ctx,
			)
		},
		/** The predecessor failed: claim its returned messages before preparing this input. */
		reclaim: ({ conversationId, input: { agent, held } }, rt, ctx) =>
			rt.commit(async (tx) => {
				const row = await tx.doc(Thread, conversationId)
				const recipient = Object.values(row.agents).find((a) => a.conversation === agent)
				held = [
					...new Set([...held, ...recipient.unseen.filter((id) => id <= Math.max(...held))]),
				].sort((a, b) => a - b)
				recipient.unseen = recipient.unseen.filter((id) => !held.includes(id))
				return { status: 'running', checkpoint: { phase: 'ask', held } }
			}, ctx),
		async ask(
			{ id, conversationId: threadId, input: { agent, held, steer }, state: { checkpoint } },
			rt,
			ctx,
		) {
			held = checkpoint.held ?? held
			const to = await agentOf(agent)
			await runners.online(to.runner, rt.signal)
			const all = await messages(threadId)
			const mine = all.filter((e) => held.includes(e.id))
			const content = catchUp
				? await catchUp(threadId, mine, all, agent)
				: mine.map(said).join('\n\n')
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
				return finished('completed', { submission, held })
			}, ctx)
		},
	},
	abort: ({ conversationId, input: { agent }, state: { checkpoint } }, rt, ctx) =>
		rt.commit(async (tx) => {
			if (checkpoint.held) await restore(tx, conversationId, agent, checkpoint.held)
			return finished('aborted')
		}, ctx),
})

/** A durable wait observes admission faults too; onReport is only diagnostic. */
const Deliver = defineTask({
	name: 'agent-ide.deliver',
	version: 1,
	initial: () => ({ phase: 'wait' }),
	phases: {
		wait: ({ input: { admit } }, rt, ctx) => rt.commit(() => waiting([admit], 'tell'), ctx),
		async tell({ conversationId: threadId, input: { admit, agent, held } }, rt, ctx) {
			const [result] = await rt.outcomes([admit], ctx)
			const settled =
				result.status === 'completed'
					? await (await harness.submission(result.result.submission, ctx)).wait(ctx)
					: {
							id: admit,
							status: 'unanswered',
							reason: result.error?.detail?.reason ?? result.status,
						}
			held = result.status === 'completed' ? result.result.held : held
			const told = await outcome(threadId, agent, settled, held)
			await rt.commit(
				async (tx) => (await tell(tx, threadId, agent, settled, held, told), finished()),
				ctx,
			)
		},
	},
	/** Pi's abort of the thread withdrew its input if still queued. */
	abort: ({ conversationId: threadId, input: { admit, agent, held } }, rt, ctx) =>
		rt.commit(async (tx) => {
			if ((await tx.submissionByRequest(agent, String(admit)))?.entry === undefined) {
				const result = (await tx.task(admit)).state.outcome?.result
				await restore(tx, threadId, agent, result?.held ?? held)
			}
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
	(f) => f.split(path.sep).join('/'),
)
const clientFiles = new Map(
	await Promise.all(
		files
			.filter((f) => types[path.extname(f)])
			.map(async (f) => [
				`/${f}`,
				{
					type: types[path.extname(f)],
					body: await readFile(new URL(`./apps/client/${f}`, import.meta.url)),
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

const known = async () => (await harness.snapshot(Runners, context)) ?? {}
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
		.filter((c) => !c.owner)
		.map((c) => c.id)

const user = (req) => speaker(req.headers['x-user'])

/** A command needs no model */
async function address(to, command = false, signal) {
	const name = field(to?.runner, 'to.runner')
	const runner = (await known())[name]
	if (!runner) throw new Error(`No runner ${name} has connected to this server`)
	const clean = {
		runner: name,
		...(command
			? {}
			: await modelOn(name, runner, typeof to.model === 'string' ? to.model.trim() : '', signal)),
	}
	for (const key of ['thinkingLevel', 'dir'])
		if (typeof to[key] === 'string' && to[key].trim()) clean[key] = to[key].trim()
	if (to.name !== undefined) {
		if (typeof to.name !== 'string' || !/^[\w.-]{1,40}$/.test(to.name))
			throw new Error('A name is 1 to 40 letters, digits, _ . or -')
		if ((await known())[to.name]) throw new Error(`${to.name} is a runner; pick another name`)
		clean.name = to.name
	}
	folder(runner, clean)
	return clean
}
/** Whom `to` asks in a thread */
const addresses = (to, command, threadId) =>
	Promise.all((to === null ? [] : [to].flat()).map((t) => whom(threadId, t, command)))
async function whom(threadId, t, command = false, signal) {
	const [, at, text = t] = (typeof t === 'string' && t.match(/^(\d+)\/(.+)$/)) || []
	if (at && Number(at) !== threadId) throw new Error(`${t} is in thread ${at}, not ${threadId}`)
	const agents = threadId !== undefined ? (await thread(threadId))?.agents : undefined
	if (typeof text === 'string' && agents?.[text]) return agentOf(agents[text].conversation, text)
	const found = typeof text === 'string' && !/[@=]/.test(text) && (await named?.(text))
	if (found) return address(found, command, signal)
	const asked = typeof text === 'string' ? agentTo(text) : text
	const recipe = await address(asked, command, signal)
	const name = !command && agentName(recipe)
	if (!name || !agents?.[name]) return recipe
	// The agent is there already; the thinking this asks with applies from this message on.
	const agent = await agentOf(agents[name].conversation, name)
	// A runner alone resolves to pi's default thinking there, which no one asked for.
	const named = asked?.thinkingLevel || (asked?.model && recipe.thinkingLevel)
	return named ? { ...agent, thinkingLevel: recipe.thinkingLevel } : agent
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

/** `named`, the agent's name when the caller has it, saves looking it up */
async function agentOf(id, named, tx) {
	const agent = tx ? await tx.doc(AgentDoc, id) : await harness.snapshot(AgentDoc, id, context)
	const runnerName = agent?.model?.provider?.match(/^runner:(.+)$/)?.[1]
	if (!runnerName) return null
	const runner = (tx ? await tx.doc(Runners) : await known())[runnerName]
	const rel = runner && agent.cwd ? path.relative(runner.dir, agent.cwd) : ''
	const dir = rel.startsWith('..') ? agent.cwd : rel
	const name = named ?? (await home(id))?.name
	return {
		runner: runnerName,
		model: agent.model.modelId,
		...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
		...(dir ? { dir } : {}),
		...(name && name !== `${agent.model.modelId}@${runnerName}` ? { name } : {}),
	}
}

// Working while a delivery to it is live
/** @returns {Promise<Agent[]>} */
async function agentsIn(row, live) {
	return Promise.all(
		Object.entries(row.agents).map(async ([name, { conversation }]) => {
			const to = await agentOf(conversation, name)
			const mine = live.filter(
				(t) => t.kind === Deliver.definition.name && t.input.agent === conversation,
			)
			const status = !mine.length
				? 'idle'
				: to && runners.isOnline(to.runner)
					? 'working'
					: 'blocked'
			return { name, conversation, to, status }
		}),
	)
}
/** The threads each runner is working for: an agent there answering, or a command running */
async function busyThreads() {
	const by = {}
	for (const t of await liveTasks()) {
		const runner =
			t.kind === Shell.definition.name
				? t.input.to?.runner
				: t.kind === Deliver.definition.name
					? (await harness.snapshot(AgentDoc, t.input.agent, context))?.model?.provider?.match(
							/^runner:(.+)$/,
						)?.[1]
					: null
		if (runner) (by[runner] ??= new Set()).add(t.conversationId)
	}
	return by
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
	return (await entries(id)).filter((e) => e.kind === KIND)
}
const lastAsked = async (id) =>
	Promise.all(
		((await messages(id)).findLast((e) => e.data.to)?.data.to ?? []).map((n) => whom(id, n)),
	)

/** An agent's own answer, which it never reads back */
const ownAnswer = ({ data: m }, name) =>
	m.author === name && !m.from && Boolean(m.answer || m.error)

/**
 * Writes a message, inside the caller's commit, and gives each agent it asks a Deliver task with all it hasn't seen.
 * A new agent reads the thread, which a commit can't do after writing: post first, or pass `empty` for a new thread.
 * @param {Message} data
 */
async function post(tx, threadId, message, options = {}) {
	let by = message.author
	if (message.from) {
		const source = (await tx.doc(Thread, message.from)).agents[message.author]
		if (!source) throw new Error('Only an agent can post from another thread')
		by = `@${(await agentOf(source.conversation, message.author, tx)).runner}`
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
		!empty && names.some((name) => !row.agents[name])
			? (
					await collect((cursor) =>
						tx.scanEntries({ conversationId: threadId, order: 'ascending' }, 500, cursor),
					)
				)
					.filter((e) => e.kind === KIND)
					.map((e) => e.id)
			: []
	const entry = await tx.appendEntry(threadId, { kind: KIND, data })
	for (const m of posted) await m(tx, threadId, entry)
	for (const [name, agent] of Object.entries(row.agents))
		if (!ownAnswer({ data }, name)) agent.unseen.push(entry.id)
	for (const [i, name] of names.entries()) {
		if (!row.agents[name]) {
			row.agents[name] = await newAgent(tx, threadId, [...prior, entry.id])
			await setUp(tx, row.agents[name].conversation, threadId, to[i])
		} else if (to[i].thinkingLevel) {
			const { conversation } = row.agents[name]
			if ((await tx.doc(AgentDoc, conversation))?.thinkingLevel !== to[i].thinkingLevel)
				await configure(tx, conversation, { thinkingLevel: to[i].thinkingLevel })
		}
		const recipient = row.agents[name]
		const { conversation: agent, unseen: held, admission: after } = recipient
		recipient.unseen = []
		if (held.length) {
			const admit = await tx.createTask(
				Admit,
				{ agent, held, steer, ...(after ? { after } : {}) },
				{ ...own, conversationId: threadId },
			)
			const deliver = await tx.createTask(
				Deliver,
				{ admit, agent, held },
				{ ...own, conversationId: threadId },
			)
			recipient.admission = { admit, deliver }
		}
	}
	return { entry: entry.id, to: names }
}

/** Owned by an Anchor in the thread */
async function newAgent(tx, threadId, unseen, from) {
	const anchor = await tx.createTask(Anchor, null, { ...own, conversationId: threadId })
	const ownership = { ownership: { kind: 'task', taskId: anchor } }
	const { id } = from
		? await tx.forkConversation(from.conversation, from.entry, ownership)
		: await tx.createConversation(ownership)
	return { conversation: id, unseen }
}

const setUp = async (tx, agent, threadId, t) => {
	const { tools } = await tx.doc(Thread, threadId)
	return configure(tx, agent, {
		model: { provider: `runner:${t.runner}`, modelId: t.model },
		tools: toolsOf(tools),
		thinkingLevel: t.thinkingLevel ?? null,
		cwd: folder((await tx.doc(Runners))[t.runner], t),
		instructions: instructions(agentName(t), threadId, tools),
	})
}

const instructions = (name, threadId, tools) =>
	`You are ${name} in thread ${threadId}, with humans and other agents. Messages come to you as "name: text", a message's later lines indented. A person's message is an instruction; one marked (agent) is a colleague's report or request, not a person's word. Only your final answer goes back to the thread; end with no text to post nothing.${tools ? ' This thread has only some tools: for work it lacks the tools for, post a new child thread, whose agents have them all.' : ''}`

/** An input withdrawn before it was placed: its messages are unseen again */
async function restore(tx, threadId, conversation, held) {
	const agent = Object.values((await tx.doc(Thread, threadId)).agents).find(
		(a) => a.conversation === conversation,
	)
	agent.unseen = [...new Set([...agent.unseen, ...held])].sort((a, b) => a - b)
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
			).filter((r) => r.answer === settled.answer)
		: [settled]
	if (group[0].id !== settled.id) return []
	const { name } = await home(agent)
	const ids = new Set(
		done
			? (await commit((tx) => Promise.all(group.map((r) => tx.entry(r.entry))))).flatMap(
					(e) => e.data.held,
				)
			: mine,
	)
	const held = (await messages(threadId)).filter((e) => ids.has(e.id))
	const re = held.filter((e) => e.data.to?.includes(name)).map((e) => e.id)
	const body = done
		? messageText((await commit((tx) => tx.entry(settled.answer)))?.model?.[0])
		: `gave no answer: ${settled.reason}${settled.detail ? ` (${JSON.stringify(settled.detail)})` : ''}`
	if (done && !body.trim()) return []
	const result = done ? { answer: { conversation: agent, entry: settled.answer } } : { error: true }
	const told = [
		{ thread: threadId, data: { author: name, body, ...(re.length ? { re } : {}), ...result } },
	]
	const posts = held.filter((e) => e.data.from && !e.data.re)
	if (posts.length && reply)
		return [
			...told,
			...(await reply(posts, threadId, name, body)).map((r) => ({ ...r, steer: true })),
		]
	return told
}

/** Posts what a settled input told; messages no input took are unseen again */
async function tell(tx, threadId, agent, settled, held, told) {
	for (const { thread, data, steer } of told) await append(tx, thread, data, { steer })
	if (settled.entry === undefined) await restore(tx, threadId, agent, held)
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
	const { admit, agent, held } = record.input
	const placed = await storage.submissionByRequest(agent, String(admit), context)
	const pending = (await harness.getTask(admit, context)).state.outcome?.result?.held ?? held
	const settled = { id: admit, status: 'unanswered', reason, entry: placed?.entry }
	const told = await outcome(threadId, agent, settled, pending)
	await commit((tx) => tell(tx, threadId, agent, settled, pending, told))
}

/** With no reader, anyone's read counts */
async function status(id, reads, agents, shell, reader) {
	if (shell || agents.some((a) => a.status === 'working')) return 'working'
	if (agents.some((a) => a.status === 'blocked')) return 'blocked'
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

async function threadRow(id, reader, live) {
	const { reads, ...row } = await thread(id)
	const agents = await agentsIn(row, live)
	const shell = live.some((t) => t.kind === Shell.definition.name && t.conversationId === id)
	return {
		id,
		...row,
		readers: Object.keys(reads),
		agents,
		shells: [...shells.values()].filter((run) => run.threadId === id),
		status: await status(id, reads, agents, shell, reader),
		conversation: await storage.conversation(id, context),
	}
}
const threadList = async (reader) => {
	const live = await liveTasks()
	return (await Promise.all((await threadIds()).map((id) => threadRow(id, reader, live)))).filter(
		(row) => !row.hidden,
	)
}
/** Who's in a thread, with no state of its own */
const peopleIn = (entries, readers) => [
	...new Set([
		...entries
			.filter((e) => !e.data.answer && !e.data.error && !e.data.from)
			.map((e) => e.data.author),
		...readers,
	]),
]
const threadView = async (id, reader) => {
	const entries = await messages(id)
	const row = await threadRow(id, reader, await liveTasks())
	return { ...row, people: peopleIn(entries, row.readers), entries }
}

/** An agent's thread owns its conversation, through its Anchor */
async function home(conversationId) {
	const threadId = (await storage.conversation(conversationId, context))?.owner?.conversationId
	const row = threadId && (await thread(threadId))
	const name =
		row && Object.keys(row.agents).find((n) => row.agents[n].conversation === conversationId)
	return name ? { thread: threadId, name } : null
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
	const body = field(input.body, 'body')
	const command = body.match(/^\$\s+([\s\S]+)/)?.[1]
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
						Object.entries((await thread(id)).agents).map(([n, a]) => agentOf(a.conversation, n)),
					)
				).filter(Boolean),
			),
			false,
			id,
		)
	if (command && !to.length) throw new Error('Pick a runner to run the command on')
	if (command) await reach(to, author, await known())
	return once(input.requestId, `post ${id}`, async (tx) =>
		command
			? (await tx.createTask(Shell, { author, command, to: to[0] }, { ...own, conversationId: id }),
				{ command, to: to[0] })
			: post(
					tx,
					id,
					{ author, body, ...(to.length ? { to } : {}) },
					{ steer: input.steer === true },
				),
	)
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
	if (!Array.isArray(tools) || !tools.length || tools.some((t) => typeof t !== 'string'))
		throw new Error('tools is a list of tool names')
	const names = new Set(
		registry
			.snapshot()
			.tools()
			.map(({ tool }) => tool.name),
	)
	const changes = tools.filter((t) => /^[+-]/.test(t))
	if (changes.length && changes.length < tools.length)
		throw new Error('tool names cannot be mixed with +name or -name entries')
	const unknown = tools.map((t) => t.replace(/^[+-]/, '')).filter((t) => !names.has(t))
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
	return tools.every((t) => /^[+-]/.test(t))
		? { remove: named(tools.filter((t) => t.startsWith('-')).map((t) => t.slice(1))) }
		: named(tools)
}

/** The thread messages an agent had seen by its entry `cut`, a fork's parent's included */
async function seenBy(id, cut) {
	const handle = await harness.conversation(id, context)
	const entries = await collect((cursor) =>
		handle.entries({ maxEntryId: cut, order: 'ascending' }, 500, cursor, context),
	)
	return entries.filter((e) => e.kind === DELIVERY).flatMap((e) => e.data.held)
}

/** Changes the thread's tools and every agent's selection together */
async function setTitle(id, { title }) {
	await conversation(id)
	title = field(title, 'title')
	return commit(async (tx) => {
		;(await tx.doc(Thread, id)).title = title
		return { title }
	})
}

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

/** Forks history and agents at `at`, but keeps the source's current thread-wide tools */
async function forkThread(id, { at, title }) {
	const shown = (await messages(id)).filter((e) => e.id <= Number(at))
	const answers = {}
	const asked = new Set()
	for (const { data } of shown) {
		if (data.answer) answers[data.author] = data.answer
		for (const name of data.to ?? []) asked.add(name)
	}
	const source = await thread(id)
	/** Asked but not answered by then: a new agent, made as the source's */
	const fresh = await Promise.all(
		[...asked]
			.filter((name) => !answers[name])
			.map(async (name) => [name, await agentOf(source.agents[name].conversation, name)]),
	)
	const agents = await Promise.all(
		Object.entries(answers).map(async ([name, answer]) => {
			const seen = new Set(await seenBy(answer.conversation, answer.entry))
			return {
				name,
				answer,
				unseen: shown.filter((e) => !seen.has(e.id) && !ownAnswer(e, name)).map((e) => e.id),
			}
		}),
	)
	const named = title?.trim() || `${source.title} (fork)`
	const fork = await (
		await conversation(id)
	).fork(
		Number(at),
		{
			...ownerless,
			init: async (tx, forkId) => {
				;(await tx.doc(Thread, forkId)).tools = source.tools
				const row = {}
				for (const { name, answer, unseen } of agents) {
					row[name] = await newAgent(tx, forkId, unseen, answer)
					await configure(tx, row[name].conversation, {
						tools: toolsOf(source.tools),
						instructions: instructions(name, forkId, source.tools),
					})
				}
				for (const [name, t] of fresh) {
					row[name] = await newAgent(
						tx,
						forkId,
						shown.filter((e) => !ownAnswer(e, name)).map((e) => e.id),
					)
					await setUp(tx, row[name].conversation, forkId, t)
				}
				Object.assign(await tx.doc(Thread, forkId), { title: named, createdAt: now(), agents: row })
			},
		},
		context,
	)
	return { id: fork.id }
}

const core = {
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
/** A list of names alone replaces the defaults, so the start line says which of them it turned off */
const dropped = Object.keys(defaults).filter(
	(n) => defaults[n] && !modules.some((m) => m.name === n),
)
for (const m of modules) if (m.extension) registry.install(m.extension)
/** One module answers each of these; two claiming one is a mistake, not an order */
const hook = (name) => {
	const [first, second] = modules.filter((m) => m[name])
	if (second)
		throw new Error(`${name}: ${first.name} and ${second.name} both answer it; turn one off`)
	return first?.[name]
}
const posted = modules.flatMap((m) => m.posted ?? [])
const hiding = modules.flatMap((m) => m.hiding ?? [])
const [route, reply, catchUp, named] = ['route', 'reply', 'catchUp', 'recipe'].map(hook)

for (const [name, runner] of Object.entries(await known()))
	models.setProvider(runnerProvider(runners, name, runner.models))
harness.resume()

async function input(req) {
	let body = ''
	for await (const chunk of req) {
		body += chunk
		if (body.length > 200000) throw new Error('Request too large')
	}
	return JSON.parse(body || '{}')
}

async function hideThread(id) {
	await conversation(id)
	await commit(async (tx) => {
		;(await tx.doc(Thread, id)).hidden = true
		for (const m of hiding) await m(tx, id)
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
		async () => ({
			port,
			file,
			modules: modules.map((m) => m.name),
			threads: (await threadIds()).length,
			runners: Object.keys(await known()).length,
			work: await harness.inspect(context),
		}),
	],
	[
		'GET /api/runners',
		async () => {
			const busy = await busyThreads()
			return Object.entries(await known()).map(([name, { models, offers, ...runner }]) => ({
				name,
				...runner,
				offers: offers ?? [],
				models: Object.keys(models ?? {}),
				online: runners.isOnline(name),
				calls: runners.working(name),
				busy: runners.isOnline(name) ? (busy[name]?.size ?? 0) : 0,
				outdated: Boolean(runner.version) && runner.version !== bundle.version,
			}))
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
		.filter((m) => m.serve)
		.flatMap((m) => [
			[`GET /api/${m.name}`, (req, _, url) => m.serve(undefined, url.searchParams)],
			[
				`POST /api/${m.name}`,
				async (req, _, url) => m.serve(undefined, url.searchParams, await input(req)),
			],
			...(m.remove ? [[`DELETE /api/${m.name}/:name`, (req, name) => m.remove(name)]] : []),
			[`GET /api/threads/:id/${m.name}`, (req, id, url) => m.serve(id, url.searchParams)],
			[
				`POST /api/threads/:id/${m.name}`,
				async (req, id, url) => m.serve(id, url.searchParams, await input(req)),
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
		(!loopback(req.socket.remoteAddress) || !loopback(req.headers.host?.replace(/:\d+$/, ''))))
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
const outdated = new Map()
function nudge() {
	for (const [name, socket] of outdated) {
		if (sockets.get(name) !== socket) outdated.delete(name)
		else if (!runners.working(name).length) {
			outdated.delete(name)
			runners.tell(name, { op: 'update' })
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
		for (const m of modules) m.changed?.()
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
	for (const w of old ?? []) await w.stop()
	const row = typeof id === 'number' && (await harness.watchDoc(Thread, id, context))
	if (!row) return
	const watches = (socket.watching = [row])
	/** A watch that comes back after the socket moved on is stopped instead */
	const keep = (w) => (socket.watching === watches ? (watches.push(w), true) : (w.stop(), false))
	const send = (message) => socket.send(JSON.stringify({ thread: id, ...message }))
	const handle = await harness.conversation(id, context)
	const messages = await handle.watch(context)
	if (!keep(messages)) return
	await told(handle, messages, send)
	const followed = new Set()
	const follow = async (agents) => {
		for (const [agent, { conversation }] of Object.entries(agents)) {
			if (followed.has(agent)) continue
			followed.add(agent)
			const w = await (
				await harness.conversation(conversation, context)
			).watch(context, { min: 20 })
			if (!keep(w)) return
			send({ agent, live: doing(w.value) })
			w.start(async ({ value }) => send({ agent, live: doing(value) }))
		}
	}
	await follow(row.value.agents)
	row.start(async ({ value }) => follow(value.agents))
}
/** The thread's messages through Pi's transcript, which keeps them whole */
async function told(handle, watch, send) {
	const transcript = new ConversationTranscript(
		(query, limit, ctx) => handle.entries(query, limit, undefined, ctx),
		{ pageSize: 500 },
	)
	let newest = 0,
		first = true
	const tell = async (value) => {
		let view = transcript.merge(value)
		while (view.items[0]?.kind === 'earlier') view = await transcript.loadEarlier(context)
		for (let gap; (gap = view.items.find((i) => i.kind === 'gap'));)
			view = await transcript.fillGap(gap, context)
		const fresh = view.items.flatMap((i) =>
			i.kind === 'entry' && i.entry.id > newest ? [i.entry] : [],
		)
		if (!fresh.length && !first) return
		first = false
		newest = fresh.at(-1)?.id ?? newest
		send({ entries: fresh.filter((e) => e.kind === KIND) })
	}
	await tell(watch.value)
	watch.start(async ({ value }) => tell(value))
}
/** What an agent is doing, from Pi's live doc */
function doing({ entries, docs }) {
	const { run, generation, tools = [] } = docs['pi.live'] ?? {}
	const calls = entries
		.flatMap((e) => (e.model?.[0]?.role === 'assistant' ? e.model[0].content : []))
		.filter((b) => b.type === 'toolCall')
	return {
		run: Boolean(run),
		message: generation?.message ?? null,
		tools: tools.map(({ callId, name, status }) => ({
			callId,
			name,
			status,
			args: calls.find((c) => c.id === callId)?.arguments,
		})),
	}
}

/** The address this request reached the server at, as a runner on another machine dials it */
const origin = (req) =>
	`${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${String(req.headers.host).replace(/[^\w.:\[\]-]/g, '')}`
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const loopback = (address) => /^(127\.|::ffff:127\.)/.test(address) || ['::1', '[::1]', 'localhost'].includes(address)

/** A new key for a runner, replacing its old one, whose runner is cut off */
async function mintKey(name, server) {
	if (!/^[\w.-]+$/.test(name))
		throw new Error('name the runner: letters, digits, dot, dash or underscore')
	if (process.env.HOST === '0.0.0.0' && loopback(new URL(server).hostname)) {
		const interfaces = os.networkInterfaces()
		const address = [...(interfaces.tailscale0 ?? []), ...Object.values(interfaces).flat()].find((a) => a.family === 'IPv4' && !a.internal)?.address
		if (address) server = server.replace(new URL(server).hostname, address)
	}
	const key = `air_${randomBytes(24).toString('base64url')}`
	await commit(async (tx) => {
		;(await tx.doc(Keys))[name] = sha256(key)
	})
	sockets.get(name)?.close(4001, `${name}'s key was replaced`)
	return {
		name,
		key,
		connect: `curl -fsSL ${server}/connect-runner | AGENT_IDE_KEY=${key} sh -s -- --name ${name} --dir .`,
	}
}
/** Takes a runner's key away */
async function revoke(name) {
	await commit(async (tx) => {
		delete (await tx.doc(Keys))[name]
	})
	sockets.get(name)?.close(4001, `${name} was revoked`)
	return { revoked: name }
}

const sockets = new Map()
/** Compressed */
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true })
async function upgrade(req, raw, head) {
	const url = new URL(req.url, 'http://localhost')
	if (url.pathname !== '/ws') return raw.destroy()
	if (req.headers.origin && req.headers.origin !== origin(req))
		return raw.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
	const socket = await new Promise((resolve) => wss.handleUpgrade(req, raw, head, resolve))
	const name = url.searchParams.get('runner')
	let closed = false
	const close = () => {
		closed = true
		clients.delete(socket)
		watch(socket, null)
		if (!name || sockets.get(name) !== socket) return
		sockets.delete(name)
		runners.disconnect(name)
		console.log(`runner ${name} offline`)
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
	const held = ((await harness.snapshot(Keys, context)) ?? {})[name]
	if (closed) return
	if (!given || held !== sha256(given)) {
		console.log(`runner ${name} turned away: ${given ? 'wrong or revoked key' : 'no key'}`)
		return socket.close(
			4001,
			given
				? `${name}'s key is wrong or was revoked; on the server: node cli.js key ${name}`
				: `${name} needs a key; on the server: node cli.js key ${name}`,
		)
	}
	if (sockets.has(name)) {
		sockets.get(name).terminate()
		runners.disconnect(name)
	}
	sockets.set(name, socket)
	const q = (param) => url.searchParams.get(param) || ''
	const resolved = (await known())[name]?.models ?? {}
	if (closed || sockets.get(name) !== socket) return
	const runner = {
		alias: q('alias'),
		owner: q('owner') && speaker(q('owner')),
		allow: url.searchParams.getAll('allow').map(speaker),
		host: q('host'),
		dir: q('dir') || '/',
		folders: url.searchParams.getAll('folder').length
			? url.searchParams.getAll('folder')
			: [q('dir') || '/'],
		readOnly: q('readOnly') === '1',
		version: q('version'),
		model: q('model'),
		modelError: q('modelError'),
		offers: url.searchParams.getAll('offer'),
		models: resolved,
	}
	await commit(async (tx) => {
		const all = await tx.doc(Runners)
		if (!closed && sockets.get(name) === socket) all[name] = runner
	})
	if (closed || sockets.get(name) !== socket) return
	if (!models.getProvider(`runner:${name}`))
		models.setProvider(runnerProvider(runners, name, resolved))
	listen(runners.receive)
	runners.connect(name, (text) => socket.send(text))
	socket.send(JSON.stringify({ op: 'ready' }))
	if (runner.version && runner.version !== bundle.version) {
		outdated.set(name, socket)
		notify()
	}
	console.log(
		`runner ${name} online: ${runner.dir}${runner.readOnly ? ' (read-only)' : ''}, default model ${runner.model || `none (${runner.modelError || 'not set'})`}${runner.owner ? `, work from ${[runner.owner, ...runner.allow].join(', ')}` : ''}`,
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
		{ stdio: 'inherit', env: { ...process.env, AGENT_IDE_KEY: key } },
	)
	for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => lent.kill(signal))
}

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
						.filter((a) => a.family === 'IPv4')
						.map((a) => a.address)
				: [host === '::1' ? '[::1]' : host]
		for (const address of addresses)
			console.log(
				`http://${address}:${server.address().port} on ${file}, modules: ${modules.map((m) => m.name).join(', ') || 'none'}${dropped.length ? ` (off, though on by default: ${dropped.join(', ')})` : ''}`,
			)
		connectSelf(
			`http://${host === '0.0.0.0' ? '127.0.0.1' : addresses[0]}:${server.address().port}`,
		).catch((error) => console.error(error))
	})
}
