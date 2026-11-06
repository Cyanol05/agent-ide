/** An agent's turns, read from its own conversation: each one line in the thread, opened into every step it took */
import html from '@solidjs/html'
import { createMemo, createRoot, createStore, For, Show } from 'solid-js'
import { api, entries, threads, titleOf } from './server.js'
import { ThreadLink } from './thread.js'
import { authorLabel, doing, lastToolCall, messageText } from './agent.js'
import { Dot } from './dot.js'
import { markdown } from './markdown.js'

/** Each agent conversation on screen, its entries as Pi keeps them */
export const [conversations, setConversations] = createRoot(() => createStore({}))
const asking = new Map()

/** Fetches a conversation again, one request at a time, and once more if asked meanwhile */
export function readConversation(id) {
	if (asking.has(id)) return void asking.set(id, true)
	asking.set(id, false)
	api(`/api/conversations/${id}`)
		.then(({ entries: all }) =>
			setConversations((all_) => {
				all_[id] = all
					.filter((entry) => entry.kind !== 'pi.system')
					.map(({ id, kind, model, data }) => ({ id, kind, model, data }))
			}),
		)
		.catch(() => {})
		.finally(() => {
			const again = asking.get(id)
			asking.delete(id)
			if (again) readConversation(id)
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
const preview = (text) => {
	const all = lines(text)
	const head = all.slice(0, 2).join('\n').slice(0, 240)
	return all.length > 2 ? `${head}\n… ${all.length - 2} more lines` : head
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

/** A turn's line, live while its agent works, and its steps behind it */
export function Turn(props) {
	const live = () => props.live && doing[props.thread]?.[props.agent.conversation]
	const now = () =>
		lastToolCall(live()) || (props.agent.status === 'blocked' ? 'blocked' : 'writing')
	return html`
		<li class="turn">
			<details>
				<summary>
					<small>
						<${Show} when=${() => props.live}><${Dot} state=${() => props.agent.status} /><//>
						${() =>
							[
								authorLabel(props.agent.name),
								props.live && now(),
								props.turn && summary(props.turn, entries[props.thread] ?? []),
							]
								.filter(Boolean)
								.join(' · ')}
					</small>
				</summary>
				<ol class="steps">
					<${For} each=${() => props.turn?.steps ?? []} keyed=${(step) => step.key}
						>${(step) => html`<${Step} step=${() => step()} thread=${() => props.thread} />`}<//
					>
					<${Show} when=${() => messageText(live()?.message)}>
						<li class="said">${() => messageText(live()?.message)}</li>
					<//>
				</ol>
			</details>
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
	return html`
		<li class=${() => ({ call: true, failed: result()?.error, running: !result() })}>
			<details>
				<summary>
					<span class="tool">${() => props.step.name}</span>(${() => argsLine(props.step)})
					<${Show} when=${() => result()?.text.trim()}>
						<span class="out">${() => preview(result().text)}</span>
					<//>
				</summary>
				<div class="whole">
					<pre>${() => JSON.stringify(props.step.args, null, 2)}</pre>
					<${Show} when=${() => result()?.text}><pre>${() => result().text}</pre><//>
				</div>
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
