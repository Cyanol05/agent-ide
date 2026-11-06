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
import { api, entries, threads, titleOf } from './server.js'
import { ThreadLink } from './thread.js'
import { authorLabel, doing, messageText } from './agent.js'
import { Dot } from './dot.js'
import { markdown } from './markdown.js'

/** Each agent conversation on screen, its entries as Pi keeps them */
export const [conversations, setConversations] = createRoot(() => createStore({}))
/** Tool calls heard on the live stream since the conversation was last read, oldest first */
export const [streamed, setStreamed] = createRoot(() => createStore({}))
const asking = new Map()

/** Reads a conversation, one request at a time, and once more if asked meanwhile; what it read replaces what was streamed */
export function readConversation(id) {
	if (asking.has(id)) return void asking.set(id, true)
	asking.set(id, false)
	api(`/api/conversations/${id}`)
		.then(({ entries: all }) => {
			setConversations((read) => {
				read[id] = all
					.filter((entry) => entry.kind !== 'pi.system')
					.map(({ id, kind, model, data }) => ({ id, kind, model, data }))
			})
			setStreamed((heard) => {
				delete heard[id]
			})
		})
		.catch(() => {})
		.finally(() => {
			const again = asking.get(id)
			asking.delete(id)
			if (again) readConversation(id)
		})
}

/** The deliveries each agent was heard answering, `{id, held, since}`, oldest first, so a turn keeps its row before it is read */
export const [delivered, setDelivered] = createRoot(() => createStore({}))

/** Keeps each tool call the live stream names, which holds only the round running now, and the delivery it answers */
export function hear(conversation, live) {
	const heard = delivered[conversation] ?? []
	if (live.delivery && !heard.some((delivery) => delivery.id === live.delivery.id)) {
		setDelivered((all) => {
			;(all[conversation] ??= []).push({ ...live.delivery, since: Date.now() })
		})
		// A turn that ended into the next without a pause is read now, so its steps leave the live one
		if (heard.length) readConversation(conversation)
	}
	setStreamed((heard) => {
		const calls = (heard[conversation] ??= [])
		for (const tool of live.tools ?? []) {
			const known = calls.find((call) => call.key === tool.callId)
			if (known) Object.assign(known, { status: tool.status, args: tool.args ?? known.args })
			else
				calls.push({
					key: tool.callId,
					name: tool.name,
					args: tool.args ?? {},
					status: tool.status,
				})
		}
	})
}

/** A conversation cut into turns: each begins with a delivery and holds the calls, results and words that follow it */
export function turnsOf(conversation) {
	const turns = []
	for (const entry of conversations[conversation] ?? []) {
		const message = entry.model?.[0]
		if (entry.kind === 'agent-ide.delivery') {
			turns.push({
				key: `${conversation}:${entry.id}`,
				conversation,
				after: Math.max(0, ...(entry.data?.held ?? [])),
				start: message?.timestamp,
				end: message?.timestamp,
				steps: [],
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

const lines = (text) => text.replace(/\n+$/, '').split('\n')
/** The first line of an output, trimmed, and how many more there are */
const preview = (text) => {
	const all = lines(text)
	const first =
		all
			.find((line) => line.trim())
			?.trim()
			.slice(0, 200) ?? ''
	return all.length > 1 ? `${first}  … +${all.length - 1}` : first
}
const seconds = (ms) => {
	const s = Math.max(0, Math.round(ms / 1000))
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A post's ask: the thread it went to, or for an answer, the thread it answered */
const askedThread = (step) => step.result?.details?.thread ?? step.args.thread
const answered = (step) => /^Answered /.test(step.result?.text ?? '')

/** The answer a thread got back to a post made in it */
export const answerOf = (messages, step) =>
	step.name === 'post' &&
	step.result &&
	!answered(step) &&
	messages.find(
		(entry) => entry.id > step.result.at && entry.data.from === askedThread(step) && entry.data.re,
	)

/** What a turn did, in a few words */
function summary(turn, messages) {
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
	const asks = tools.filter((step) => step.name === 'post' && !answered(step) && askedThread(step))
	const posts = (word, list) =>
		list.length && `${word} ${list.map((step) => titleOf(askedThread(step))).join(', ')}`
	const parts = [
		edited.length && `edited ${edited.join(', ')}`,
		commands && plural(commands, 'command'),
		posts('asked', asks),
		posts(
			'answered',
			tools.filter((step) => step.name === 'post' && answered(step)),
		),
		tools.length && plural(tools.length, 'step'),
		turn.end - turn.start >= 1000 && seconds(turn.end - turn.start),
	]
	const back = asks.filter((step) => answerOf(messages, step)).length
	if (back)
		parts.splice(
			parts.indexOf(posts('asked', asks)) + 1,
			0,
			back === asks.length ? 'answered' : `${back} answered`,
		)
	return parts.filter(Boolean).join(' · ')
}

/** One clock for every live turn, ticking only while one is on screen */
const [clock, setClock] = createRoot(() => createSignal(Date.now()))
let ticking = 0,
	timer
const tick = () => {
	if (!ticking++) timer = setInterval(() => setClock(Date.now()), 1000)
	return () => --ticking || clearInterval(timer)
}

/** How many steps a live turn shows below its line, the newest last */
const TAIL = 3

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
	/** The steps read so far, then those heard live since; a heard step that's done has no output until the turn is read */
	const steps = createMemo(() => {
		const known = props.turn?.steps ?? []
		if (props.turn && !props.live && !props.latest) return known
		const heard = (streamed[props.agent.conversation] ?? [])
			.filter((call) => !known.some((step) => step.key === call.key))
			.map((call) => ({
				...call,
				result: call.status === 'done' ? { text: '', heard: true } : null,
			}))
		return [...known, ...heard]
	})
	const now = () => {
		const running = steps().findLast((step) => step.name && !step.result)
		if (running)
			return running.name === 'post'
				? `asking ${askedThread(running) ? titleOf(askedThread(running)) : (running.args.title ?? 'a new thread')}`
				: `${running.name}(${argsLine(running)})`
		if (props.agent.status === 'blocked') return 'waiting for its runner'
		return messageText(live()?.message) ? 'writing' : 'thinking'
	}
	const line = () => {
		if (!props.live) return summary({ ...props.turn, steps: steps() }, entries[props.thread] ?? [])
		const start = props.turn?.start ?? props.since
		return [
			now(),
			steps().length && plural(steps().length, 'step'),
			start && clock() - start >= 1000 && seconds(clock() - start),
		]
			.filter(Boolean)
			.join(' · ')
	}
	const said = () => messageText(live()?.message)
	const tail = () => steps().slice(-TAIL)
	return html`
		<li class=${() => ({ turn: true, live: !!props.live })}>
			<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
				<summary>
					<small>
						<${Show} when=${() => props.live}><${Dot} state=${() => props.agent.status} /><//>
						<span>${() => authorLabel(props.agent.name)}</span> · <span class="now">${line}</span>
					</small>
				</summary>
				<${Show} when=${open}>
					<ol class="steps">
						<${For} each=${steps} keyed=${(step) => step.key}
							>${(step) => html`<${Step} step=${() => step()} thread=${() => props.thread} />`}<//
						>
						<${Show} when=${said}><li class="said">${said}</li><//>
					</ol>
				<//>
			</details>
			<${Show} when=${() => props.live && !open()}>
				<ol class="steps tail">
					<${Show} when=${() => steps().length > TAIL}>
						<li class="earlier">${() => `… ${plural(steps().length - TAIL, 'earlier step')}`}</li>
					<//>
					<${For} each=${tail} keyed=${(step) => step.key}
						>${(step) => html`<${Step} step=${() => step()} thread=${() => props.thread} />`}<//
					>
					<${Show} when=${said}><li class="said">${said}</li><//>
				</ol>
			<//>
		</li>
	`
}

function Step(props) {
	const step = () => props.step
	return html`
		<${Show}
			when=${() => step().name}
			fallback=${() => html`<li class="said">${() => step().said}</li>`}
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

/** ⏺ tool(args), ⎿ the start of its output; opened, both whole */
function Call(props) {
	const result = () => props.step.result
	const [open, setOpen] = createSignal(false)
	return html`
		<li class=${() => ({ call: true, failed: result()?.error, running: !result() })}>
			<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
				<summary>
					<span class="tool">${() => props.step.name}</span>(${() => argsLine(props.step)})
					<${Show} when=${() => result()?.text.trim()}>
						<span class="out">${() => preview(result().text)}</span>
					<//>
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
					${() => (answered(props.step) ? 'answered ' : answer() ? `${authorLabel(answer().author)} answered in ` : 'asked ')}
					<${ThreadLink} id=${() => asked()}>${() => titleOf(asked())}<//>
					<span class="out">${() => preview((answer() ?? props.step.args).body ?? '')}</span>
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
