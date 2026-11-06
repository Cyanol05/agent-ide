/** A thread owns its message subscription while it is on screen. */
import html from '@solidjs/html'
import { createEffect, createMemo, createSignal, For, reconcile, Show } from 'solid-js'
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
import { answerOf, conversations, cutsOf, heard, Turn, turnsOf } from './run.js'
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
	const [unfolded, setUnfolded] = createSignal(false)
	/**
	 * The thread's messages with each agent turn after the last message its delivery held, and a live one while it works.
	 * A turn that only answered is its answer; an answer to a post shows in the post.
	 */
	const rows = createMemo(() => {
		const all = messages()
		const turns = (thread()?.agents ?? []).flatMap((agent) => {
			const live = doing[props.id]?.[agent.conversation]
			const turns = turnsOf(agent.conversation).map((turn) => ({
				key: turn.key,
				agent,
				turn,
				at: turn.after + 0.5,
				live: !!live?.run && live.delivery?.id === turn.delivery,
			}))
			// Asked while its runner is offline, before any delivery
			if (agent.status === 'blocked' && !live?.run)
				turns.push({ key: `${agent.conversation}:waiting`, agent, at: (all.at(-1)?.id ?? 0) + 0.5, live: true })
			// A turn that only answered is its answer
			return turns.filter((row) => row.live || !row.turn || row.turn.steps.some((step) => step.label !== 'handed'))
		})
		const steps = turns.flatMap((row) => row.turn?.steps ?? [])
		const answers = new Set(steps.map((step) => answerOf(all, step)?.id))
		// A question from another thread holds the answer said here to it alone, as a reply under it: a post's, else the run's last words
		const questions = new Set(all.filter((entry) => entry.data.from && !entry.data.re).map((entry) => entry.id))
		const replies = new Map()
		for (const entry of all)
			if (!entry.data.from && entry.data.re?.every((id) => questions.has(id)))
				for (const id of entry.data.re)
					if (!replies.has(id) || (replies.get(id).data.answer && !entry.data.answer)) replies.set(id, entry)
		const inside = new Set([...replies.values()].map((entry) => entry.id))
		const shown = all.filter((entry) => !answers.has(entry.id) && !inside.has(entry.id))
		const said = shown.map((entry) => ({ key: entry.id, entry, at: entry.id, reply: replies.get(entry.id) }))
		const cuts = (thread()?.agents ?? []).flatMap((agent) =>
			cutsOf(agent.conversation).map((cut) => ({ ...cut, cut: true })),
		)
		// What the agent reads as lines folds into them, unless opened from the newest cut's line
		const newest = cuts.reduce((best, cut) => (!best || cut.at > best.at ? cut : best), null)
		const folded = newest && !unfolded() ? newest : null
		const above = (row) => folded && row.at < folded.at
		const lines = folded ? folded.lines.map((line) => ({ ...line, line: true })) : []
		const rows = [...said.filter((row) => !above(row)), ...turns.filter((row) => !above(row)), ...lines, ...cuts].sort((one, other) => one.at - other.at)
		// A message after a turn's line says who wrote it again
		for (const [index, row] of rows.entries()) if (row.entry) row.previous = rows[index - 1]?.entry
		return rows
	})
	/** The list waits for its messages and each agent's conversation, so it shows folded at once instead of shifting */
	const ready = () =>
		!!entries[props.id] && (thread()?.agents ?? []).every((agent) => conversations[agent.conversation])
	const titleClick = () => (current() !== props.id ? openThread(props.id) : drawer('side'))
	let list,
		stuck = true
	createEffect(
		() => props.id,
		(id) => {
			if (!id) return
			let first = true
			/** Agents whose whole conversation came on this watch; the next batch from each is appended */
			const followed = new Set()
			stuck = true
			const close = watch(
				(message) => {
					if (message.thread !== id) return
					if (message.entries && !message.agent) {
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
					if (message.agent && message.entries) {
						heard(message.agent, message.entries, !followed.has(message.agent))
						followed.add(message.agent)
					}
					if (message.live)
						setDoing((work) => {
							work[id] ??= {}
							work[id][message.agent] = message.live
						})
				},
				(socket) => {
					first = true
					followed.clear()
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
			ready(),
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
					<${Show} when=${() => props.id && !ready()}
						><li class="mute asking">Asking for messages…</li><//
					>
					<${Show} when=${() => homeBot(props.id)?.instructions === ''}>
						<li class="mute">
							${() =>
								`${homeBot(props.id).name} has no instructions yet. ` +
								`Talk to ${homeBot(props.id).name} and find out who it is.`}
						</li>
					<//>
					<${For} each=${() => (ready() ? rows() : [])} keyed=${(row) => row.key}
						>${(row) => html`
							<${Show}
								when=${() => !row().cut && !row().line}
								fallback=${() => html`
									<${Show}
										when=${() => row().cut}
										fallback=${() => html`
											<li class="line mute" title=${() => `messages ${row().at} to ${row().at + row().n - 1}`}>
												<small>${() => `${row().at}+${row().n}`}</small>
												<span>${() => row().text}</span>
											</li>
										`}
									>
										<li class="cut mute">
											<button type="button" onClick=${() => setUnfolded((on) => !on)}>
												${() =>
													(unfolded() ? 'fold again: ' : 'unfold: ') +
													(row().memory
														? 'above here the agent reads the memory lines'
														: 'above here the agent reads a summary')}
											</button>
										</li>
									<//>
								`}
							>
							<${Show}
								when=${() => row().turn || row().live}
								fallback=${() => html`
									<${Message}
										thread=${() => props.id}
										entry=${() => row().entry}
										reply=${() => row().reply}
										previous=${() => row().previous}
									/>
								`}
							>
								<${Turn}
									thread=${() => props.id}
									agent=${() => row().agent}
									turn=${() => row().turn}
									live=${() => row().live}
								/>
							<//>
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
					<${Show} when=${() => props.reply}>
						<div class="reply">
							<small title=${() => props.reply.data.author} style=${() => colorOf(props.reply.data.author)}
								>${() => `← ${authorLabel(props.reply.data.author)} answered`}</small
							>
							<${Body} data=${() => props.reply.data} />
							<${Images} images=${() => props.reply.data.images} />
						</div>
					<//>
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
