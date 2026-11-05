/** A thread owns its message subscription while it is on screen. */
import html from '@solidjs/html'
import { createEffect, createMemo, For, reconcile, Show } from 'solid-js'
import {
	colorOf,
	current,
	drawer,
	entries,
	fork,
	forkedFrom,
	homeBot,
	me,
	newThreadTools,
	openThread,
	setEntries,
	threads,
	titleOf,
	watch,
} from './server.js'
import { authorLabel, doing, lastToolCall, messageText, setDoing } from './agent.js'
import { Composer } from './composer.js'
import { Dot } from './dot.js'

export const ThreadLink = (props) => html`
	<a
		class="thread-link"
		href=${() => {
			const next = new URL(location.href)
			next.searchParams.set('thread', props.id)
			return next.pathname + next.search
		}}
		onClick=${(e) => {
			e.preventDefault()
			openThread(props.id)
		}}
		>${() => props.children}</a
	>
`

export function Thread(props) {
	const thread = createMemo(() => threads.find((t) => t.id === props.id))
	const messages = () => entries[props.id] ?? []
	const titleClick = () => (current() !== props.id ? openThread(props.id) : drawer('side'))
	let list,
		stuck = true
	createEffect(
		() => props.id,
		(id) => {
			if (!id) return
			let first = true
			const close = watch(
				(m) => {
					if (m.thread !== id) return
					stuck = !list || list.scrollTop + list.clientHeight >= list.scrollHeight - 4
					if (m.entries) {
						const snapshot = first
						first = false
						setEntries((all) => {
							all[id] ??= []
							if (snapshot) reconcile(m.entries, 'id')(all[id])
							else all[id].push(...m.entries)
						})
					}
					if (m.live)
						setDoing((work) => {
							work[id] ??= {}
							work[id][m.agent] = m.live
						})
				},
				(socket) => {
					first = true
					socket.send(JSON.stringify({ watch: id }))
				},
			)
			// Its messages stay, so coming back shows them at once while the snapshot catches up.
			return () => {
				close()
				setDoing((work) => {
					delete work[id]
				})
			}
		},
	)
	createEffect(
		() => [
			messages().length,
			Object.values(doing[props.id] ?? {}).map((d) => messageText(d.message)),
		],
		() => {
			if (list && stuck) list.scrollTop = list.scrollHeight
		},
	)
	return html`
		<article
			data-thread=${() => props.id}
			class=${() => [
				'thread',
				{
					current: current() === props.id,
					'hands-off': !!(props.id ? thread()?.tools : newThreadTools()),
				},
			]}
		>
			<header
				role="button"
				tabindex="0"
				title="Thread details and tools"
				onClick=${titleClick}
				onKeyDown=${(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						titleClick()
					}
				}}
			>
				<span>${() => (props.id ? thread()?.title || 'untitled' : 'a new thread')}</span>
				<${Dot} state=${() => thread()?.status} />
			</header>
			<nav class="from">
				<${Show} when=${() => forkedFrom(thread())}
					>${(id) => html`
						<${ThreadLink} id=${() => id()}>${() => `← forked from ${titleOf(id())}`}<//>
					`}<//
				>
			</nav>
			<${Show} when=${() => props.id}>
				<ul
					ref=${(el) => {
						list = el
					}}
					aria-label="Messages"
				>
					<${Show} when=${() => props.id && !entries[props.id]}
						><li class="mute asking">Asking for messages…</li><//
					>
					<${Show} when=${() => homeBot(props.id)?.instructions === ''}>
						<li class="mute">
							${() =>
								`${homeBot(props.id).name} has no instructions yet. ` +
								`Talk to ${homeBot(props.id).name} and find out who it is.`}
						</li>
					<//>
					<${For} each=${() => messages()}
						>${(message, index) => html`
							<${Message}
								thread=${() => props.id}
								entry=${() => message}
								previous=${() => messages()[index() - 1]}
							/>
						`}<//
					>
					<${For} each=${() => thread()?.agents ?? []}
						>${(agent) => html`
							<${Writing} agent=${() => agent} live=${() => doing[props.id]?.[agent.name]} />
						`}<//
					>
				</ul>
			<//>
			<${Composer} thread=${() => props.id} />
		</article>
	`
}

/** The socket says a run ended before the thread list says the agent is idle: trust the socket until the list agrees. */
function Writing(props) {
	let running = false,
		ended = false
	const shown = createMemo(() => {
		const run = props.live?.run,
			busy = ['working', 'blocked'].includes(props.agent.status)
		if (run) [running, ended] = [true, false]
		else if (running) [running, ended] = [false, true]
		if (!busy) ended = false
		return run || (busy && !ended)
	})
	return html`
		<${Show} when=${shown}>
			<li class="writing">
				<small title=${() => lastToolCall(props.live)}>
					<${Dot} state=${() => props.agent.status} />
					${() =>
						`${authorLabel(props.agent.name)} · ` +
						(lastToolCall(props.live) ||
							(props.agent.status === 'blocked' ? 'blocked' : 'writing'))}
				</small>
				${() => messageText(props.live?.message)}
			</li>
		<//>
	`
}

function Message(props) {
	const data = () => props.entry.data
	const elsewhere = () => data().from && data().from !== props.thread
	const forks = () =>
		threads.filter(
			(t) =>
				!t.hidden && forkedFrom(t) === props.thread && t.conversation.parent.at === props.entry.id,
		)
	return html`
		<li
			class=${() => ({
				elsewhere: elsewhere(),
				reply: elsewhere() && data().re,
				mine: !elsewhere() && data().author === me,
				same:
					!elsewhere() &&
					data().author !== me &&
					!props.previous?.data.from &&
					props.previous?.data.author === data().author,
			})}
		>
			<${Show}
				when=${() => elsewhere() && data().re}
				fallback=${html`
					<${Show} when=${() => elsewhere()}>
						<div class="links">
							<${ThreadLink} id=${() => data().from}
								>${() => `→ asked from ${titleOf(data().from)}`}<//
							>
						</div>
					<//>
					<small title=${() => data().author} style=${() => colorOf(data().author)}
						>${() => authorLabel(data().author)}</small
					>
					<span class="body">${() => data().body}</span>
				`}
			>
				<details>
					<summary>
						<${Show}
							when=${() => homeBot(data().from)?.name === data().author}
							fallback=${() => html`
								<span style=${() => colorOf(data().author)}
									>${() => authorLabel(data().author)}</span
								>
								answered in <${ThreadLink} id=${() => data().from}>${() => titleOf(data().from)}<//>
							`}
						>
							<span style=${() => colorOf(data().author)}>
								<${ThreadLink} id=${() => data().from}>${() => authorLabel(data().author)}<//>
							</span>
							answered
						<//>
					</summary>
					<span class="body">${() => data().body}</span>
				</details>
			<//>
			<${For} each=${() => forks()}
				>${(f) => html`
					<div class="links">
						<${ThreadLink} id=${() => f.id}>${() => `forked → ${f.title}`}<//>
					</div>
				`}<//
			>
			<button
				class="fork"
				title="A new thread from this message"
				onClick=${() => fork(props.thread, props.entry.id).catch((e) => alert(e.message))}
			>
				fork
			</button>
		</li>
	`
}
