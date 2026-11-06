/** A thread owns its message subscription while it is on screen. */
import html from '@solidjs/html'
import { createEffect, createMemo, For, reconcile, Show } from 'solid-js'
import {
	closeColumn,
	colorOf,
	current,
	drawer,
	entries,
	fork,
	followThread,
	forkedFrom,
	homeBot,
	hrefOf,
	me,
	newThreadTools,
	openThread,
	setEntries,
	setPeople,
	threads,
	titleOf,
	watch,
} from './server.js'
import { authorLabel, doing, lastToolCall, messageText, setDoing, toolLine } from './agent.js'
import { Composer } from './composer.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { imageUrl } from './images.js'
import { markdown } from './markdown.js'

export const ThreadLink = (props) => html`
	<a
		class="thread-link"
		href=${() => hrefOf(props.id)}
		onClick=${(event) => followThread(event, props.id)}
		>${() => props.children}</a
	>
`

export function Thread(props) {
	const thread = createMemo(() => threads.find((thread) => thread.id === props.id))
	const messages = () => entries[props.id] ?? []
	const titleClick = () => (current() !== props.id ? openThread(props.id) : drawer('side'))
	let list,
		stuck = true
	createEffect(
		() => props.id,
		(id) => {
			if (!id) return
			let first = true
			stuck = true
			const close = watch(
				(message) => {
					if (message.thread !== id) return
					if (message.entries) {
						const snapshot = first
						first = false
						// Your own send always shows, live or in a reconnect's snapshot; others' entries follow only a view already at the bottom.
						const shown = new Set((entries[id] ?? []).map((entry) => entry.id))
						if (message.entries.some((entry) => entry.data.author === me && !shown.has(entry.id))) stuck = true
						setEntries((all) => {
							all[id] ??= []
							if (snapshot) reconcile(message.entries, 'id')(all[id])
							else all[id].push(...message.entries)
						})
					}
					if (message.people)
						setPeople((all) => {
							all[id] = message.people
						})
					if (message.live)
						setDoing((work) => {
							work[id] ??= {}
							work[id][message.agent] = message.live
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
			thread()?.agents.map((agent) => agent.status),
			Object.values(doing[props.id] ?? {}).map((live) => messageText(live.message)),
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
			<header>
				<h2 class="title">
					<button type="button" title="Thread details and tools" onClick=${titleClick}>
						<span>${() => (props.id ? thread()?.title || 'untitled' : 'a new thread')}</span>
						<${Dot} state=${() => thread()?.status} />
					</button>
				</h2>
				<${Show} when=${() => current() !== props.id}>
					<button
						type="button"
						class="close"
						title="Close here; the thread details still list it"
						aria-label="Close"
						onClick=${() => closeColumn(props.id)}
					>
						×
					</button>
				<//>
			</header>
			<p class="from">
				<${Show} when=${() => forkedFrom(thread())}
					>${(id) => html`
						<${ThreadLink} id=${() => id()}>${() => `← forked from ${titleOf(id())}`}<//>
					`}<//
				>
			</p>
			<${Show} when=${() => props.id}>
				<ul
					ref=${(el) => {
						list = el
					}}
					onScroll=${() => {
						stuck = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
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
							<${Writing} agent=${() => agent} live=${() => doing[props.id]?.[agent.conversation]} />
						`}<//
					>
				</ul>
			<//>
			<${Composer} thread=${() => props.id} />
		</article>
	`
}

/** While the server says the agent works or waits for its runner: one line, and what it has done so far behind it */
function Writing(props) {
	return html`
		<${Show} when=${() => props.agent.status !== 'idle'}>
			<${Working} agent=${() => props.agent} live=${() => props.live} />
		<//>
	`
}

/** A turn's row, made afresh each time the agent starts, so what it has run belongs to this turn */
function Working(props) {
	// The live doc holds only the tool running now, so keep the calls as they come and go
	const called = []
	const calls = () => {
		for (const tool of props.live?.tools ?? []) {
			const known = called.find((call) => call.callId === tool.callId)
			if (known) known.line = toolLine(tool)
			else called.push({ callId: tool.callId, line: toolLine(tool) })
		}
		return called.map((call) => call.line).join('\n')
	}
	return html`
		<li class="writing">
			<details>
				<summary title=${() => lastToolCall(props.live)}>
					<small>
						<${Dot} state=${() => props.agent.status} />
						${() =>
							`${authorLabel(props.agent.name)} · ` +
							(lastToolCall(props.live) ||
								(props.agent.status === 'blocked' ? 'blocked' : 'writing'))}
					</small>
				</summary>
				<${Show} when=${() => calls()}>
					<div class="calls">${() => calls()}</div>
				<//>
				<div class="body">${() => messageText(props.live?.message)}</div>
			</details>
		</li>
	`
}

function Message(props) {
	const data = () => props.entry.data
	const elsewhere = () => data().from && data().from !== props.thread
	const forks = () =>
		threads.filter(
			(thread) =>
				!thread.hidden && forkedFrom(thread) === props.thread && thread.conversation.parent.at === props.entry.id,
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
					<${Body} data=${() => data()} />
					<${Images} images=${() => data().images} />
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
					<${Body} data=${() => data()} />
					<${Images} images=${() => data().images} />
				</details>
			<//>
			<${For} each=${() => forks()}
				>${(fork) => html`
					<div class="links">
						<${ThreadLink} id=${() => fork.id}>${() => `forked → ${fork.title}`}<//>
					</div>
				`}<//
			>
			<button
				class="fork"
				title="A new thread from this message"
				onClick=${() => fork(props.thread, props.entry.id).catch(report)}
			>
				fork
			</button>
		</li>
	`
}

/** What a message says: markdown, except a `$ cmd` and an error, which stay as written */
const Body = (props) => html`
	<${Show}
		when=${() => !props.data.shell && !props.data.error}
		fallback=${html`<span class="body">${() => props.data.body}</span>`}
	>
		<div class="body markdown" innerHTML=${() => markdown(props.data.body)} />
	<//>
`

/** A message's images, as it sent them */
const Images = (props) => html`
	<${Show} when=${() => props.images?.length}>
		<div class="images">
			<${For} each=${() => props.images}
				>${(image) => html`<img src=${() => imageUrl(image)} alt="" loading="lazy" />`}<//
			>
		</div>
	<//>
`
