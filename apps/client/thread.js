/** A thread owns its message subscription while it is on screen. */
import html from '@solidjs/html'
import {
	createEffect,
	createMemo,
	createProjection,
	createSignal,
	For,
	getOwner,
	latest,
	reconcile,
	runWithOwner,
	Show,
} from 'solid-js'
import {
	api,
	closeColumn,
	colorOf,
	columns,
	current,
	drawer,
	entries,
	merged,
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
import { authorLabel, doing, setDoing } from './agent.js'
import { answersIn, asksOf, conversations, cutsOf, Exchange, heard, newestCut, Turn, turnsOf } from './run.js'
import { Composer } from './composer.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { imageUrl } from './images.js'
import { markdown } from './markdown.js'

export function Thread(props) {
	const thread = createMemo(() => threads.find((thread) => thread.id === props.id))
	const messages = () => entries[props.id] ?? []
	const [unfolded, setUnfolded] = createSignal(false)
	/** Each agent's turns and cuts, worked out again only when its own conversation grows, not when a message lands */
	const owner = getOwner()
	const memos = new Map()
	const perConversation = (conversation) => {
		if (!memos.has(conversation))
			runWithOwner(owner, () =>
				memos.set(conversation, {
					turns: createMemo(() => turnsOf(conversation)),
					cuts: createMemo(() => cutsOf(conversation)),
				}),
			)
		return memos.get(conversation)
	}
	/**
	 * The thread's messages with each agent turn after the last message its delivery held, and a live one while it works.
	 * A turn that only answered is its answer; an answer to a post shows in the post.
	 */
	let built = new Map()
	const rows = createProjection(
		() => {
			const all = messages()
			const turns = (latest(thread)?.agents ?? []).flatMap((agent) => {
				const live = doing[props.id]?.[agent.conversation]
				const turns = perConversation(agent.conversation)
					.turns()
					.map((turn) => ({
						key: turn.key,
						agent,
						turn,
						at: turn.after + 0.5,
						live: !!live?.run && live.delivery?.id === turn.delivery,
					}))
				// Asked while its runner is offline, before any delivery
				if (agent.status === 'blocked' && !live?.run)
					turns.push({
						key: `${agent.conversation}:waiting`,
						agent,
						at: (all.at(-1)?.id ?? 0) + 0.5,
						live: true,
					})
				// A turn that only answered is its answer
				return turns.filter(
					(row) => row.live || !row.turn || row.turn.steps.some((step) => step.label !== 'handed'),
				)
			})
			const answerOf = answersIn(all)
			// A question from another thread holds the answer said here to it alone, as a reply under it: a post's, else the run's last words
			const questions = new Set(
				all.filter((entry) => entry.data.from && !entry.data.re).map((entry) => entry.id),
			)
			const replies = new Map()
			for (const entry of all)
				if (!entry.data.from && entry.data.re?.every((id) => questions.has(id)))
					for (const id of entry.data.re)
						if (!replies.has(id) || (replies.get(id).data.answer && !entry.data.answer))
							replies.set(id, entry)
			const inside = new Set([...replies.values()].map((entry) => entry.id))
			// The run that answered such a question alone sits in its box between question and answer, whatever else it did
			const runs = new Map()
			const byId = new Map(all.map((entry) => [entry.id, entry]))
			const turnsAfter = Map.groupBy(turns, (row) => row.turn?.after)
			for (const [id, reply] of replies) {
				const question = byId.get(id)
				const run = turnsAfter
					.get(id)
					?.find((row) => row.turn && row.agent.name === reply.data.author)
				if (run && question && reply.data.re.length === 1) runs.set(id, run)
			}
			const boxed = new Set(runs.values())
			// An answer to an ask line shows in it; one with no line (a boxed run's post, say) stays a message
			const answers = new Set(
				turns.flatMap((row) =>
					row.turn && !boxed.has(row) ? row.turn.steps.map((step) => answerOf(step)?.id) : [],
				),
			)
			const shown = all.filter((entry) => !answers.has(entry.id) && !inside.has(entry.id))
			// Each ask an agent made here is one line after its run, open to the whole exchange
			const asks = turns
				.filter((row) => row.turn && !boxed.has(row))
				.flatMap((row) =>
					asksOf(row.turn.steps)
						.filter((step) => step.result)
						.map((step, index) => {
							const answer = answerOf(step) || undefined
							const back =
								answer &&
								perConversation(row.agent.conversation)
									.turns()
									.find((turn) => turn.held.includes(answer.id))?.start
							return {
								key: `${row.key}:ask:${step.key}`,
								ask: step,
								agent: row.agent,
								answer,
								back,
								at: row.at + (index + 1) / 1000,
							}
						}),
				)
			const said = shown.map((entry) => ({
				key: entry.id,
				entry,
				at: entry.id,
				reply: replies.get(entry.id),
				run: runs.get(entry.id),
			}))
			const cuts = (latest(thread)?.agents ?? []).flatMap((agent) =>
				perConversation(agent.conversation)
					.cuts()
					.map((cut) => ({ ...cut, cut: true })),
			)
			// One cut line, the newest compaction's; what the agent reads as lines folds into them, unless opened from it
			const newest = newestCut(cuts)
			const folded = newest && !unfolded() ? newest : null
			const above = (row) => folded && row.at < folded.at
			const lines = folded ? folded.lines.map((line) => ({ ...line, line: true })) : []
			const rows = [
				...said.filter((row) => !above(row)),
				...turns.filter((row) => !above(row) && !boxed.has(row)),
				...asks.filter((row) => !above(row)),
				...lines,
				...(newest ? [newest] : []),
			].sort((one, other) => one.at - other.at)
			// A message or run line names its author only when it isn't the last one's that wasn't yours: your own are marked by where they sit
			let last
			for (const row of rows) {
				row.above = last
				const author = row.entry ? !row.entry.data.from && row.entry.data.author : row.agent?.name
				if (author !== me) last = author
			}
			// A row that didn't change is handed back as the same object, so the diff skips it and an update costs the rows it touched
			const next = new Map()
			const reused = rows.map((row) => {
				const before = built.get(row.key)
				const same =
					before &&
					Object.keys(row).length === Object.keys(before).length &&
					Object.keys(row).every((key) => row[key] === before[key])
				next.set(row.key, same ? before : row)
				return same ? before : row
			})
			built = next
			return reused
		},
		[],
		{ key: 'key' },
	)
	/** The list waits for its messages and each agent's conversation, so it shows folded at once instead of shifting */
	const ready = () =>
		!!entries[props.id] &&
		(thread()?.agents ?? []).every((agent) => conversations[agent.conversation])
	const titleClick = () => (current() !== props.id ? openThread(props.id) : drawer('side'))
	let list,
		followed,
		stuck = true
	/** Marks the thread read for me, but only while I'm actually looking: a hidden tab shouldn't clear the dot for an answer nobody saw */
	const markRead = (id) => {
		if (document.visibilityState === 'visible') api(`/api/threads/${id}/read`, {}).catch(report)
	}
	createEffect(
		() => props.id,
		(id) => {
			if (!id) return
			let first = true
			/** Agents whose whole conversation came on this watch; the next batch from each is appended */
			const followed = new Set()
			stuck = true
			sent = null
			if (room) room.style.height = '0px'
			markRead(id)
			const onVisible = () => markRead(id)
			document.addEventListener('visibilitychange', onVisible)
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
							all[id] = merged(
								snapshot ? (all[id] ?? []).filter((entry) => entry.sending) : (all[id] ?? []),
								message.entries,
							)
						})
						if (!snapshot) markRead(id)
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
							work[id][message.agent] ??= {}
							reconcile(message.live, 'callId')(work[id][message.agent])
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
				document.removeEventListener('visibilitychange', onVisible)
				setDoing((work) => {
					delete work[id]
				})
			}
		},
	)
	/** Where your last message ends in the list; the room under it is what the answer hasn't filled yet */
	let sent = null,
		room,
		bottom = () => {}
	// What you send keeps some of the view free under it, so the answer fills that without moving anything, and what came before stays in sight
	createEffect(
		() => messages().at(-1)?.sending,
		(mine) => {
			if (!mine || !list) return
			stuck = true
			const row = [...list.querySelectorAll(':scope > li.mine')].at(-1)
			sent = row
				? row.getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop
				: null
			bottom()
		},
	)
	/** Following the bottom watches the list's real size: a row added or growing, an image loading, the list itself resized */
	const follow = (list) => {
		const fill = () => {
			if (sent === null) return
			const style = getComputedStyle(list)
			const top = parseFloat(style.paddingTop)
			const seen = list.clientHeight - top - parseFloat(style.paddingBottom)
			const end =
				room.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
			// A short thread already has the room, below the view's own end
			const free = sent + 0.4 * seen <= top + seen ? 0 : Math.max(0, sent + 0.4 * seen - end)
			room.style.height = `${free}px`
			if (!free) sent = null
		}
		bottom = () => {
			fill()
			if (stuck) list.scrollTop = list.scrollHeight
			followed = list.scrollHeight
		}
		const sizes = new ResizeObserver(() => {
			const column = list.parentElement
			const height = (element) => {
				if (!element) return 0
				sizes.observe(element)
				if (!element.getClientRects().length) return 0
				const style = getComputedStyle(element)
				return (
					element.getBoundingClientRect().height +
					parseFloat(style.marginTop) +
					parseFloat(style.marginBottom)
				)
			}
			column.style.setProperty(
				'--thread-top',
				`${height(column.querySelector(':scope > header')) + height(column.querySelector(':scope > p.from'))}px`,
			)
			column.style.setProperty(
				'--compose-height',
				`${height(column.querySelector(':scope > form.compose'))}px`,
			)
			bottom()
		})
		sizes.observe(list)
		new MutationObserver((changes) => {
			for (const change of changes)
				for (const row of change.addedNodes) if (row.nodeType === 1) sizes.observe(row)
		}).observe(list, { childList: true })
	}
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
					<button
						type="button"
						class="thread-pill"
						title="Thread details and tools"
						style=${() => colorOf(homeBot(props.id)?.name ?? '')}
						onClick=${titleClick}
					>
						<span>${() => (props.id ? thread()?.title || 'untitled' : 'a new thread')}</span>
						<${Dot} state=${() => thread()?.status} />
					</button>
				</h2>
				<${Show} when=${() => props.id && columns().length > 1}>
					<button
						type="button"
						class="round close"
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
						follow(el)
					}}
					onScroll=${() => {
						// Only a scroll at the height we last followed is the reader's; one from content moving under them keeps following
						if (list.scrollHeight === followed)
							stuck = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
					}}
					aria-label="Messages"
				>
					<${Show} when=${() => props.id && !ready()}
						><li class="mute asking">Asking for messages…</li><//
					>
					<${Show} when=${() => ready() && homeBot(props.id)?.instructions === ''}>
						<li class="mute">
							${() =>
								`${homeBot(props.id).name} has no instructions yet. ` +
								`Talk to ${homeBot(props.id).name} and find out who it is.`}
						</li>
					<//>
					<${For} each=${() => (ready() ? rows : [])} keyed=${(row) => row.key}
						>${(row) => html`
							<${Show}
								when=${() => !row().cut && !row().line}
								fallback=${() => html`
									<${Show}
										when=${() => row().cut}
										fallback=${() => html`
											<li
												class="line mute"
												title=${() => `messages ${row().at} to ${row().at + row().n - 1}`}
											>
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
									when=${() => !row().ask}
									fallback=${() => html`
										<${Exchange}
											thread=${() => props.id}
											step=${() => row().ask}
											agent=${() => row().agent}
											answer=${() => row().answer}
											back=${() => row().back}
										/>
									`}
								>
									<${Show}
										when=${() => row().turn || row().live}
										fallback=${() => html`
											<${Message}
												thread=${() => props.id}
												entry=${() => row().entry}
												reply=${() => row().reply}
												run=${() => row().run}
												above=${() => row().above}
											/>
										`}
									>
										<${Turn}
											thread=${() => props.id}
											agent=${() => row().agent}
											turn=${() => row().turn}
											live=${() => row().live}
											above=${() => row().above}
										/>
									<//>
								<//>
							<//>
						`}<//
					>
					<li class="room" aria-hidden="true" ref=${(el) => (room = el)}></li>
				</ul>
			<//>
			<${Composer} thread=${() => props.id} />
		</article>
	`
}

export function Message(props) {
	const data = () => props.entry.data
	const elsewhere = () => !props.embedded && data().from && data().from !== props.thread
	const forks = () =>
		threads.filter(
			(thread) =>
				!thread.archived &&
				forkedFrom(thread) === props.thread &&
				thread.conversation.parent.at === props.entry.id,
		)
	return html`
		<li
			class=${() => ({
				elsewhere: elsewhere(),
				reply: elsewhere() && data().re,
				mine: !elsewhere() && data().author === me,
				same: !elsewhere() && data().author !== me && props.above === data().author,
			})}
		>
			<${Show}
				when=${() => elsewhere() && data().re}
				fallback=${html`
					<${Show}
						when=${() => elsewhere()}
						fallback=${html`<small
							title=${() => data().author}
							style=${() => colorOf(data().author)}
							>${() => authorLabel(data().author)}</small
						>`}
					>
						<small title=${() => data().author}>
							<${Crossing} data=${() => data()} arrow="→" home="asked from" other="asked from" />
						</small>
					<//>
					<${Body} data=${() => data()} />
					<${Images} images=${() => data().images} />
					<${Show} when=${() => props.run}>
						<ul class="run">
							<${Turn}
								thread=${() => props.thread}
								agent=${() => props.run.agent}
								turn=${() => props.run.turn}
								live=${() => props.run.live}
								handed=${() => props.run.turn.held.length !== 1}
							/>
						</ul>
					<//>
					<${Show} when=${() => props.reply}>
						<div class="reply">
							<small title=${() => props.reply.data.author}
								><span class="cross">← </span
								><span style=${() => colorOf(props.reply.data.author)}
									>${() => authorLabel(props.reply.data.author)}</span
								>
								answered</small
							>
							<${Body} data=${() => props.reply.data} />
							<${Images} images=${() => props.reply.data.images} />
						</div>
					<//>
				`}
			>
				<details>
					<summary>
						<${Crossing} data=${() => data()} arrow="←" home="answered" other="answered in" after />
					</summary>
					<${Body} data=${() => data()} />
					<${Images} images=${() => data().images} />
				</details>
			<//>
			<${Show} when=${() => !props.embedded && data().picked}>
				<div class="links" title="The director chose whom this asks">
					${() => (data().to?.length ? 'director picked ' : 'director picked nobody: ')}
					<${For} each=${() => data().to ?? []}
						>${(name) => html`<span style=${() => colorOf(name)}>${() => authorLabel(name)}</span>: `}<//
					>${() => data().picked}
				</div>
			<//>
			<${For} each=${() => (props.embedded ? [] : forks())}
				>${(fork) => html`
					<div class="links">
						<${ThreadLink} id=${() => fork.id}>${() => `forked → ${fork.title}`}<//>
					</div>
				`}<//
			>
			<${Show} when=${() => !props.embedded && !props.entry.sending}>
				<button
					class="tiny fork"
					title="A new thread from this message"
					onClick=${() => fork(props.thread, props.entry.id).catch(report)}
				>
					fork
				</button>
			<//>
		</li>
	`
}

/**
 * Who crossed threads: a bot answering from its own thread is named by a link to it; anyone else is named, then the thread.
 * `home` is the word beside a bot's link, before it unless `after`; `other` the words between a name and its thread.
 */
function Crossing(props) {
	const data = () => props.data
	const name = () => authorLabel(data().author)
	return html`
		<span class="cross">${() => `${props.arrow} `}</span>
		<${Show}
			when=${() => homeBot(data().from)?.name === data().author}
			fallback=${() => html`
				<span style=${() => colorOf(data().author)}>${name}</span>
				${() => ` ${props.other} `}
				<${ThreadLink} id=${() => data().from}>${() => titleOf(data().from)}<//>
			`}
		>
			${() => (props.after ? '' : `${props.home} `)}
			<span style=${() => colorOf(data().author)}>
				<${ThreadLink} id=${() => data().from}>${name}<//>
			</span>
			${() => (props.after ? ` ${props.home}` : '')}
		<//>
	`
}

/** What a message says: markdown, except a `$ cmd` and an error, which stay as written */
export const Body = (props) => html`
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
				>${(image) => {
					// Data URLs display inline, but browsers block opening them as pages.
					const url = createMemo(() => {
						const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0))
						return URL.createObjectURL(new Blob([bytes], { type: image.mimeType }))
					})
					createEffect(url, (url) => () => URL.revokeObjectURL(url))
					return html`<a href=${() => url()} target="_blank" rel="noopener noreferrer" aria-label="Open image full size">
						<img src=${() => imageUrl(image)} alt="" loading="lazy" />
					</a>`
				}}<//
			>
		</div>
	<//>
`

export const ThreadLink = (props) => html`
	<a
		class="thread-link"
		href=${() => hrefOf(props.id)}
		onClick=${(event) => followThread(event, props.id)}
		>${() => props.children}</a
	>
`
