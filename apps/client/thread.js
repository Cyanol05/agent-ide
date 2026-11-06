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
import { authorLabel, doing, messageText, setDoing } from './agent.js'
import { answerOf, conversations, hear, readConversation, streamed, Turn, turnsOf } from './run.js'
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
	/** Each agent's conversation is read when the thread opens and as a turn starts or ends; the live stream fills in between */
	let read = []
	createEffect(
		() =>
			(thread()?.agents ?? []).map(
				(agent) =>
					`${agent.conversation}:${agent.status !== 'idle' || !!doing[props.id]?.[agent.conversation]?.run}`,
			),
		(agents) => {
			for (const agent of agents)
				if (!read.includes(agent)) readConversation(Number(agent.split(':')[0]))
			read = agents
		},
	)
	/** A live turn keeps the row it started in, though its entries are read later: its key, its place and its start */
	const liveRows = new Map()
	const keys = new Map()
	let next = 0
	/**
	 * The thread's messages with each agent turn after the last message it was handed, and a live one while it works.
	 * A turn that only answered is its answer; an answer to a post shows in the post.
	 */
	const rows = createMemo(() => {
		const all = messages()
		const turns = (thread()?.agents ?? []).flatMap((agent) => {
			const turns = turnsOf(agent.conversation).map((turn) => ({
				key: keys.get(turn.key)?.key ?? turn.key,
				agent,
				turn,
				at: keys.get(turn.key)?.at ?? turn.after + 0.5,
			}))
			const last = turns.at(-1)
			const waiting = liveRows.get(agent.conversation)
			const working = agent.status !== 'idle'
			const read = conversations[agent.conversation] !== undefined
			// The turn running now is read once the last one read hasn't ended, or there's one more than when its row began
			const caught =
				read &&
				last &&
				(working ? !last.turn.ended : true) &&
				(!waiting?.read || turns.length > waiting.turns)
			if (caught && (working || waiting)) {
				// A turn heard live keeps its row once its entries are read: same key, same place
				if (waiting) {
					keys.set(last.turn.key, waiting)
					Object.assign(last, { key: waiting.key, at: waiting.at })
					liveRows.delete(agent.conversation)
				}
				last.live = working && !last.turn.ended
			} else if (working || waiting) {
				// Started, but not read yet: a row after the newest message, until it is, even once it ended
				const row = waiting ?? {
					key: `${agent.conversation}:next:${next++}`,
					at: (all.at(-1)?.id ?? 0) + 0.5,
					since: Date.now(),
				}
				if (read && !row.read) Object.assign(row, { read, turns: turns.length })
				liveRows.set(agent.conversation, row)
				turns.push({ ...row, agent, live: working })
			}
			// The newest turn also holds the steps heard live since its read, so it never blinks out before the next one
			const newest = turns.at(-1)
			if (newest) newest.latest = true
			return turns.filter(
				(row) =>
					row.live ||
					!row.turn ||
					row.turn.steps.length ||
					(row.latest && streamed[agent.conversation]?.length),
			)
		})
		const steps = turns.flatMap((row) => row.turn?.steps ?? [])
		const shown = all.filter((entry) => !steps.some((step) => answerOf(all, step)?.id === entry.id))
		const said = shown.map((entry) => ({ key: entry.id, entry, at: entry.id }))
		const rows = [...said, ...turns].sort((one, other) => one.at - other.at)
		// A message after a turn's line says who wrote it again
		for (const [index, row] of rows.entries()) if (row.entry) row.previous = rows[index - 1]?.entry
		return rows
	})
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
						if (message.entries.some((entry) => entry.data.author === me && !shown.has(entry.id)))
							stuck = true
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
					if (message.live) hear(message.agent, message.live)
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
				<${Show} when=${() => props.id}>
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
					<${For} each=${() => rows()} keyed=${(row) => row.key}
						>${(row) => html`
							<${Show}
								when=${() => row().turn || row().live}
								fallback=${() => html`
									<${Message}
										thread=${() => props.id}
										entry=${() => row().entry}
										previous=${() => row().previous}
									/>
								`}
							>
								<${Turn}
									thread=${() => props.id}
									agent=${() => row().agent}
									turn=${() => row().turn}
									live=${() => row().live}
									latest=${() => row().latest}
									since=${() => row().since}
								/>
							<//>
						`}<//
					>
				</ul>
			<//>
			<${Composer} thread=${() => props.id} />
		</article>
	`
}

function Message(props) {
	const data = () => props.entry.data
	const elsewhere = () => data().from && data().from !== props.thread
	const forks = () =>
		threads.filter(
			(thread) =>
				!thread.hidden &&
				forkedFrom(thread) === props.thread &&
				thread.conversation.parent.at === props.entry.id,
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
