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
	bots,
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
import { authorLabel, doing, setDoing, shortLabel } from './agent.js'
import { answersIn, asksOf, conversations, cutsOf, Exchange, heard, newestCut, Turn, turnsOf } from './run.js'
import { Composer } from './composer.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { imageUrl } from './images.js'
import { markdown } from './markdown.js'

/** A folded summary's text, without the literal <summary> wrapper tags some memories still carry */
const stripSummaryTag = (text) =>
	(text ?? '').replace(/^\s*<\/?summary>\s*\n?/im, '').replace(/\n\s*<\/?summary>\s*$/im, '')

/** Its first line of words, without the markdown around them, to stand for it folded */
const firstLine = (text) =>
	(stripSummaryTag(text).split('\n').find((line) => line.trim()) ?? '')
		.replace(/^\s*(#+|[-*>]|\d+\.)\s*/, '')
		.replace(/[*_`]/g, '')
		.trim()

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
			// An answer said here to a question from another thread names where it went
			const byId = new Map(all.map((entry) => [entry.id, entry]))
			// Only a question goes back, and only once: an answer that came back here sends nothing on, nor does what follows the first answer
			const firstAnswer = new Map()
			for (const entry of all)
				if (!entry.data.from)
					for (const id of entry.data.re ?? []) if (!firstAnswer.has(id)) firstAnswer.set(id, entry.id)
			const sentTo = (entry) =>
				entry.data.from
					? undefined
					: (entry.data.re ?? [])
							.map((id) => byId.get(id))
							.find(
								(question) =>
									question?.data.from && !question.data.re && firstAnswer.get(question.id) === entry.id,
							)
			// An answer to an ask line shows in it; one with no line stays a message
			const answers = new Set(
				turns.flatMap((row) => (row.turn ? row.turn.steps.map((step) => answerOf(step)?.id) : [])),
			)
			const shown = all.filter((entry) => !answers.has(entry.id))
			// Each ask an agent made here is one line after its run, open to the whole exchange
			const asks = turns
				.filter((row) => row.turn)
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
				sent: sentTo(entry),
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
				...turns.filter((row) => !above(row)),
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
		/** The line you tap holds still: what opens grows downward, and what closes near the end leaves room under it until something new comes */
		let held = null,
			padded = false
		list.addEventListener(
			'click',
			(event) => {
				const summary = event.target.closest?.('summary')
				if (!summary || !list.contains(summary)) return
				const details = summary.parentElement
				const was = details.open
				const hold = (held = { summary, top: summary.getBoundingClientRect().top })
				const release = () =>
					requestAnimationFrame(() =>
						requestAnimationFrame(() => {
							if (held === hold) held = null
						}),
					)
				// A line fills in once it hears its own toggle, so the hold lasts until that has been laid out
				details.addEventListener('toggle', release, { once: true })
				// A click that toggled nothing, like a link in the line, lets go at once
				requestAnimationFrame(() => {
					if (details.open === was) {
						details.removeEventListener('toggle', release)
						release()
					}
				})
			},
			true,
		)
		const keep = () => {
			const shift = held.summary.getBoundingClientRect().top - held.top
			const short = list.scrollTop + shift + list.clientHeight - list.scrollHeight
			if (short > 0) {
				room.style.height = `${room.offsetHeight + short}px`
				padded = true
			}
			if (shift) list.scrollTop += shift
			// Opening a line is the reader's move: following goes on only if the view still ends at the bottom
			stuck = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
			followed = list.scrollHeight
		}
		bottom = () => {
			if (held) return keep()
			if (padded && sent === null) room.style.height = '0px'
			padded = false
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
						<span>${() => (props.id ? thread()?.title : 'a new thread')}</span>
						<${Dot} state=${() => thread()?.status} />
					</button>
				</h2>
				<${Show} when=${() => props.id && columns().length > 1}>
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
												class="line"
												title=${() => `messages ${row().at} to ${row().at + row().n - 1}`}
											>
												<details>
													<summary><small>${() => firstLine(row().text)}</small></summary>
													<div class="body markdown" innerHTML=${() => markdown(stripSummaryTag(row().text))} />
												</details>
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
												sent=${() => row().sent}
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
	const elsewhere = () => data().from && data().from !== props.thread
	const crossed = () => !!(elsewhere() || props.sent)
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
				elsewhere: crossed(),
				mine: !elsewhere() && data().author === me,
				same: !crossed() && data().author !== me && props.above === data().author,
			})}
		>
			<${Show}
				when=${crossed}
				fallback=${html`
					<small title=${() => data().author}
						><span style=${() => colorOf(data().author)}>${() => authorLabel(data().author)}</span></small
					>
					<${Body} data=${() => data()} />
					<${Images} images=${() => data().images} />
				`}
			>
				<ol class="steps">
					<${Cross}
						sent=${() => !!props.sent}
						author=${() => props.sent?.data.author ?? data().author}
						thread=${() => props.sent?.data.from ?? data().from}
						data=${() => data()}
					/>
				</ol>
			<//>
			<${Show} when=${() => data().picked}>
				<div class="links" title="The director chose whom this asks">
					${() => (data().to?.length ? 'director picked ' : 'director picked nobody: ')}
					<${For} each=${() => data().to ?? []}
						>${(name) => html`<span style=${() => colorOf(name)}>${() => authorLabel(name)}</span>: `}<//
					>${() => data().picked}
				</div>
			<//>
			<${For} each=${forks}
				>${(fork) => html`
					<div class="links">
						<${ThreadLink} id=${() => fork.id}>${() => `forked → ${fork.title}`}<//>
					</div>
				`}<//
			>
			<${Show} when=${() => !props.entry.sending}>
				<button
					class="small fork"
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
 * A message that crossed threads, as a step of a run: → sent or ← received, the other side in its bot's colour, the
 * message's first line; opened, the whole of it. A question is muted and starts closed, an answer is ink and starts open.
 * The other side is a bot by its name, a thread's agent by its thread's title, or its model while the thread has none.
 */
export function Cross(props) {
	const bot = () => bots.some((bot) => bot.name === props.author)
	const title = () => threads.find((thread) => thread.id === props.thread)?.title
	const label = () => (bot() || !title() ? shortLabel(props.author) || titleOf(props.thread) : title())
	const answer = () => !!props.data.re
	return html`
		<li class=${() => ['call', props.sent ? 'sent' : 'received', { asked: !answer() }]}>
			<details open=${answer}>
				<summary
					title=${() => props.title ?? `${props.sent ? 'to' : 'from'} ${props.author || label()} in thread ${props.thread}`}
				>
					<span class="tool" style=${() => colorOf(props.author)}
						><${ThreadLink} id=${() => props.thread}>${label}<//></span
					>
					<span class="in">${() => (props.data.body ?? '').replace(/\s+/g, ' ')}</span>
				</summary>
				<div class="whole">
					<${Body} data=${() => props.data} />
					<${Images} images=${() => props.data.images} />
				</div>
			</details>
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
