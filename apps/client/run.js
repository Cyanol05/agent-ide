/** An agent's turns, read from its own conversation: each one line in the thread, opened into every step it took */
import html from '@solidjs/html'
import {
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	createStore,
	For,
	Show,
} from 'solid-js'
import { colorOf, entries, homeBot, threads, titleOf } from './server.js'
import { Message, ThreadLink } from './thread.js'
import { authorLabel, doing, messageText } from './agent.js'
import { Dot } from './dot.js'
import { markdown } from './markdown.js'

/**
 * Each agent conversation on screen, its entries as Pi keeps them.
 * Entries never change once written, so the store is shallow: a read tracks the conversation, not each entry's fields.
 */
export const [conversations, setConversations] = createRoot(() =>
	createStore({}, { shallow: true }),
)
/** Takes an agent's entries off the socket: whole on each new watch, then each one once, as it's written */
export function heard(conversation, entries, whole) {
	const shown = entries.filter((entry) => entry.kind !== 'pi.system')
	setConversations((all) => {
		all[conversation] = whole || !all[conversation] ? shown : [...all[conversation], ...shown]
	})
}

/** A delivery's words, whether Pi kept them as a string or as blocks beside images */
const handedText = (message) =>
	typeof message?.content === 'string' ? message.content : messageText(message)

/**
 * Where an agent's newest compaction cuts, as the thread's message ids: the first message of the first delivery the agent still reads whole.
 * Older compactions are history the agent no longer reads, so they don't show. `memory` is whether the summary is the thread's memory lines, or Pi's own.
 */
export function cutsOf(conversation) {
	const all = conversations[conversation] ?? []
	return all
		.filter((entry) => entry.kind === 'pi.compaction')
		.slice(-1)
		.flatMap((entry) => {
			const kept = all.find(
				(other) => other.kind === 'agent-ide.delivery' && other.id >= entry.head,
			)
			const first = Math.min(...(kept?.data?.held ?? []))
			if (!Number.isFinite(first)) return []
			const summary = messageText(entry.model?.[0]) || ''
			// With memory the summary is its lines, `id+n|text`; otherwise it is Pi's own text
			const lines = [...summary.matchAll(/^(\d+)\+(\d+)\|(.*)$/gm)].map((line) => ({
				key: `${conversation}:${line[1]}+${line[2]}`,
				at: Number(line[1]),
				n: Number(line[2]),
				text: line[3],
			}))
			return [
				{
					key: `${conversation}:cut:${entry.id}`,
					id: entry.id,
					at: first - 0.5,
					memory: lines.length > 0,
					lines: lines.length
						? lines
						: [{ key: `${conversation}:summary:${entry.id}`, at: 0, n: first, text: summary }],
				},
			]
		})
}

/** A conversation cut into turns: each begins with a delivery and holds the calls, results and words that follow it */
export function turnsOf(conversation, list = conversations[conversation]) {
	const turns = []
	for (const entry of list ?? []) {
		const message = entry.model?.[0]
		if (entry.kind === 'agent-ide.delivery') {
			turns.push({
				key: `${conversation}:${entry.id}`,
				conversation,
				delivery: entry.id,
				held: entry.data?.held ?? [],
				after: Math.max(0, ...(entry.data?.held ?? [])),
				start: message?.timestamp,
				end: message?.timestamp,
				// What the agent was handed opens its steps
				steps: [{ key: `${entry.id}:handed`, label: 'handed', text: handedText(message) }],
				ended: false,
			})
			continue
		}
		const turn = turns.at(-1)
		if (!turn || !message) continue
		turn.end = message.timestamp ?? turn.end
		if (message.role === 'assistant') {
			turn.ended = !['toolUse'].includes(message.stopReason)
			for (const block of message.content ?? []) {
				if (block.type === 'toolCall')
					turn.steps.push({
						key: block.id,
						name: block.name,
						args: block.arguments ?? {},
						result: null,
					})
				else if (block.type === 'thinking' && block.thinking?.trim())
					turn.steps.push({
						key: `${entry.id}:thought:${turn.steps.length}`,
						label: 'thought',
						text: block.thinking,
					})
				// The last words are the answer, which the thread shows itself
				else if (block.type === 'text' && block.text.trim() && message.stopReason === 'toolUse')
					turn.steps.push({ key: `${entry.id}:said`, said: block.text })
			}
		}
		if (message.role === 'toolResult') {
			const step = turn.steps.find((step) => step.key === message.toolCallId)
			if (step)
				step.result = {
					at: entry.id,
					time: message.timestamp,
					text: messageText(message),
					error: message.isError,
					details: message.details,
				}
		}
	}
	return turns
}

/** A step's arguments in one line, what it touches first */
const argsLine = ({ name, args }) =>
	name === 'post'
		? args.thread
			? `#${args.thread}`
			: (args.title ?? '')
		: (
				args.command ??
				args.path ??
				args.pattern ??
				args.query ??
				args.code ??
				JSON.stringify(args)
			).split('\n')[0]

export const seconds = (ms) => {
	const s = Math.max(0, Math.round(ms / 1000))
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A post's ask: the thread it went to, or for an answer, the thread it answered */
export const askedThread = (step) => step.result?.details?.thread ?? step.args.thread
const answered = (step) => /^Answered /.test(step.result?.text ?? '')
/** The posts a turn made that ask another thread, rather than answer one */
export const asksOf = (steps) =>
	steps.filter((step) => step.name === 'post' && !answered(step) && askedThread(step))

/** Each post's answer, looked up by the thread it asked instead of scanning every message per post */
export function answersIn(messages) {
	const byThread = new Map()
	for (const entry of messages)
		if (entry.data.from && entry.data.re)
			byThread.set(entry.data.from, [...(byThread.get(entry.data.from) ?? []), entry])
	return (step) =>
		step.name === 'post' &&
		step.result &&
		!answered(step) &&
		byThread.get(askedThread(step))?.find((entry) => entry.id > step.result.at)
}

/** The answer a thread got back to a post made in it */
export const answerOf = (messages, step) =>
	step.name === 'post' &&
	step.result &&
	!answered(step) &&
	messages.find(
		(entry) => entry.id > step.result.at && entry.data.from === askedThread(step) && entry.data.re,
	)

/** What a turn did, in a few words; its asks have their own lines */
function summary(turn) {
	const tools = turn.steps.filter((step) => step.name)
	const edited = [
		...new Set(
			tools
				.filter(
					(step) => ['edit', 'write'].includes(step.name) && step.result && !step.result.error,
				)
				.map((step) => step.args.path?.split('/').pop()),
		),
	].filter(Boolean)
	const commands = tools.filter((step) => step.name === 'bash').length
	const posts = (word, list) =>
		list.length && `${word} ${list.map((step) => titleOf(askedThread(step))).join(', ')}`
	const parts = [
		edited.length && `edited ${edited.join(', ')}`,
		commands && plural(commands, 'command'),
		posts(
			'answered',
			tools.filter((step) => step.name === 'post' && answered(step)),
		),
		tools.length && plural(tools.length, 'step'),
		turn.end - turn.start >= 1000 && seconds(turn.end - turn.start),
	]
	// A turn with no call only thought, before its answer or instead of one
	return parts.filter(Boolean).join(' · ') || 'thought'
}

/** One clock for every live turn, ticking only while one is on screen */
export const [clock, setClock] = createRoot(() => createSignal(Date.now()))
let ticking = 0,
	timer
export const tick = () => {
	if (!ticking++) timer = setInterval(() => setClock(Date.now()), 1000)
	return () => --ticking || clearInterval(timer)
}

/** How many steps a live turn shows below its line, the newest last */

/**
 * A turn's line. While its agent works, the step it's in now, and below it the last few steps and the words coming in;
 * when the turn ends, its summary. Open, every step in order.
 */
export function Turn(props) {
	const live = () => props.live && doing[props.thread]?.[props.agent.conversation]
	const [open, setOpen] = createSignal(false)
	createEffect(
		() => props.live,
		(on) => (on ? tick() : undefined),
	)
	// In a box that already shows the question, the run doesn't repeat it as handed
	const steps = () =>
		(props.turn?.steps ?? []).filter((step) => props.handed !== false || step.label !== 'handed')
	const now = () => {
		const running = steps().findLast((step) => step.name && !step.result)
		if (running)
			return running.name === 'post'
				? `asking ${askedThread(running) ? titleOf(askedThread(running)) : (running.args.title ?? 'a new thread')}`
				: `${running.name}(${argsLine(running)})`
		if (props.agent.status === 'blocked') return 'waiting for its runner'
		return messageText(live()?.message) ? 'writing' : 'thinking'
	}
	const calls = () => steps().filter((step) => step.name)
	/** A closed turn's summary, worked out when its steps change; an equal string updates nothing */
	const summed = createMemo(() => (props.live ? '' : summary({ ...props.turn, steps: steps() })))
	const line = () => {
		if (!props.live) return summed()
		const start = props.turn?.start
		return [
			now(),
			calls().length && plural(calls().length, 'step'),
			start && clock() - start >= 1000 && seconds(clock() - start),
		]
			.filter(Boolean)
			.join(' · ')
	}
	const said = () => messageText(live()?.message)
	return html`
		<li class=${() => ({ turn: true, live: !!props.live })}>
			<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
				<summary>
					<small>
						<${Show} when=${() => props.live}><${Dot} state=${() => props.agent.status} /><//>
						<${Show} when=${() => props.above !== props.agent.name}
							><span>${() => authorLabel(props.agent.name)}</span>${() =>
								props.lead ? ` ${props.lead} ` : ' · '}<//
						><span class="now">${line}</span>
					</small>
				</summary>
				<${Show} when=${open}>
					<ol class="steps" style=${() => `--label: ${labelWidth(steps())}ch`}>
						<${For} each=${steps} keyed=${(step) => step.key}
							>${(step) => html`<${Step} step=${() => step()} thread=${() => props.thread} />`}<//
						>
						<${Show} when=${said}><li class="said">${said}</li><//>
					</ol>
				<//>
			</details>
		</li>
	`
}

function Step(props) {
	const step = () => props.step
	return html`
		<${Show}
			when=${() => step().name}
			fallback=${() =>
				step().label
					? html`<${Told} step=${() => step()} />`
					: html`<li class="said">${() => step().said}</li>`}
		>
			<${Show}
				when=${() => step().name === 'post' && askedThread(step())}
				fallback=${() => html`<${Call} step=${() => step()} />`}
			>
				<${Ask} step=${() => step()} thread=${() => props.thread} />
			<//>
		<//>
	`
}

/** The widest label among a turn's steps, so their inputs start at one column */
const labelWidth = (steps) =>
	Math.max(
		...steps.map(
			(step) =>
				(step.name === 'post' && askedThread(step) ? 'answered' : (step.name ?? step.label ?? ''))
					.length,
		),
	)

/** A step's input as it was stored, on one line */
const input = (step) => (step.name ? JSON.stringify(step.args) : (step.text ?? ''))

/** • tool and its input; opened, input and output whole */
function Call(props) {
	const result = () => props.step.result
	const [open, setOpen] = createSignal(false)
	return html`
		<li class=${() => ({ call: true, failed: result()?.error, running: !result() })}>
			<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
				<summary>
					<span class="tool">${() => props.step.name}</span>
					<span class="in">${() => input(props.step)}</span>
				</summary>
				<${Show} when=${open}>
					<div class="whole">
						<pre>${() => JSON.stringify(props.step.args, null, 2)}</pre>
						<${Show} when=${() => result()?.text}><pre>${() => result().text}</pre><//>
					</div>
				<//>
			</details>
		</li>
	`
}

/** What the agent was handed, or what it thought: closed, one line; opened, whole */
function Told(props) {
	const [open, setOpen] = createSignal(false)
	return html`
		<li class=${() => `call told ${props.step.label}`}>
			<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
				<summary>
					<span class="tool">${() => props.step.label}</span>
					<span class="in">${() => input(props.step)}</span>
				</summary>
				<${Show} when=${open}>
					<div class="whole"><pre>${() => props.step.text}</pre></div>
				<//>
			</details>
		</li>
	`
}

/** A post: the thread it asked, live while that thread works, then the answer that came back */
function Ask(props) {
	const asked = () => askedThread(props.step)
	const answer = createMemo(() => answerOf(entries[props.thread] ?? [], props.step)?.data)
	const state = () =>
		!answered(props.step) && !answer() && threads.find((thread) => thread.id === asked())?.status
	return html`
		<li class="call ask">
			<details>
				<summary>
					<${Show} when=${() => state() === 'working' || state() === 'blocked'}
						><${Dot} state=${() => state()}
					/><//>
					<span class="tool"
						>${() => (answered(props.step) || answer() ? 'answered' : 'asked')}</span
					>
					<span class="in"
						><${ThreadLink} id=${() => asked()}>${() => titleOf(asked())}<//
						>${() => ` ${props.step.args.body ?? ''}`}</span
					>
				</summary>
				<div class="whole">
					<div class="body markdown" innerHTML=${() => markdown(props.step.args.body ?? '')} />
					<${Show} when=${() => answer()}>
						<div class="body markdown" innerHTML=${() => markdown(answer().body)} />
					<//>
				</div>
			</details>
		</li>
	`
}

/**
 * An ask, from the thread that asked: one quiet line, "→ who · answered · 6s", its dot pulsing while the answer is out.
 * Opened, the question and answer as ordinary messages.
 */
export function Exchange(props) {
	const asked = () => askedThread(props.step)
	const state = () => !props.answer && threads.find((thread) => thread.id === asked())?.status
	const out = () => state() === 'working' || state() === 'blocked'
	const who = () =>
		props.answer?.data.author ??
		homeBot(asked())?.name ??
		threads.find((thread) => thread.id === asked())?.agents?.[0]?.name
	createEffect(
		() => !props.answer,
		(waiting) => (waiting ? tick() : undefined),
	)
	const took = () => {
		const start = props.step.result?.time
		const end = props.back ?? (props.answer ? undefined : clock())
		return start && end && end - start >= 1000 ? seconds(end - start) : ''
	}
	const [open, setOpen] = createSignal(false)

	return html`
		<li class="elsewhere reply exchange">
			<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
				<summary>
					<small>
						<${Show} when=${out}><${Dot} state=${() => state()} /> <//>
						<span class="cross">→ </span
						><span style=${() => colorOf(who() ?? '')}
							><${ThreadLink} id=${() => asked()}
								>${() => (who() ? authorLabel(who()) : titleOf(asked()))}<//
							></span
						>${() =>
							[props.answer ? 'answered' : out() ? 'asking' : 'asked', took()]
								.filter(Boolean)
								.map((part) => ` · ${part}`)
								.join('')}
					</small>
				</summary>
				<${Show} when=${open}>
					<ul class="box">
						<${Message}
							thread=${() => props.thread}
							entry=${() => ({ data: { ...props.step.args, author: props.agent?.name } })}
							embedded=${true}
						/>
						<${Show} when=${() => props.answer}>
							<${Message}
								thread=${() => props.thread}
								entry=${() => props.answer}
								embedded=${true}
								above=${() => props.agent?.name}
							/>
						<//>
					</ul>
				<//>
			</details>
		</li>
	`
}
