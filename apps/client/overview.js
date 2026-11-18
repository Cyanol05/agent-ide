/**
 * A thread's overview, as a column beside it: its page's first line, then its topics and the threads it started together,
 * grouped by where they stand, waiting on you first, each thread with its own page's first line. Where each child stands
 * comes from the thread list; only the lines and the page are the model's, and a Working line whose threads have stopped
 * since it was written doesn't stay under Working. The column being open is what keeps the page written.
 */
import html from '@solidjs/html'
import { createMemo, createSignal, For, onSettled, refresh, Show, untrack } from 'solid-js'
import { openSide, PageTabs } from './side.js'
import { Panes } from './panes.js'
import { Icon } from './icons.js'
import { Dot } from './dot.js'
import { api, followThread, hrefOf, threads } from './server.js'
import { markdown } from './markdown.js'
import { report } from './notice.js'
import { threadLink } from './thread.js'

/**
 * The column's groups, in order: the page's sections and the child threads in the same state share one, each drawn with
 * the mark the sidebar gives that state. Idle has only threads; a group longer than FOLDED, and Done, start folded.
 */
const GROUPS = [
	{ key: 'waiting', label: 'Waiting on you', state: 'blocked' },
	{ key: 'working', label: 'Working', state: 'working' },
	{ key: 'idle', label: 'Idle', state: '' },
	{ key: 'done', label: 'Done', check: true },
]
const FOLDED = 8
/** A child's group, from its status and its own page */
const groupOf = (thread, page) =>
	page?.waiting
		? 'waiting'
		: ['working', 'blocked'].includes(thread.status)
			? 'working'
			: !page || page.open
				? 'idle'
				: 'done'
const running = (thread) => ['working', 'blocked'].includes(thread?.status)
/** A page as its first line and each section's bullets, by group, each bullet with the lines under it */
function parse(page) {
	const [summary = '', ...rest] = (page ?? '').split('\n')
	const sections = {}
	let at
	for (const line of rest) {
		const heading = line.match(/^##\s+(.*?)\s*$/)?.[1]
		if (heading !== undefined)
			at = GROUPS.find((group) => group.label.toLowerCase() === heading.toLowerCase())?.key
		else if (!at || (!line.trim() && !sections[at]?.length)) continue
		else if (/^\s*[-*] /.test(line) || !sections[at]?.length) (sections[at] ??= []).push(line)
		else sections[at][sections[at].length - 1] += `\n${line}`
	}
	return { summary: summary.trim(), sections }
}
/** The threads a bullet names as @"title" */
const named = (bullet) =>
	[...bullet.matchAll(/@"([^"]+)"/g)]
		.map((match) => threads.find((thread) => thread.title === match[1]))
		.filter(Boolean)

export function Overview(props) {
	// One thread for this column's whole life
	const id = untrack(() => props.id)
	// Fetched with ?open, so the server knows someone's looking: a page behind catches up, and answers keep it current
	const page = createMemo(() => api(`/api/threads/${id}/overview?open`))
	const pages = createMemo(() => api('/api/overview'))
	onSettled(() => {
		const timer = setInterval(() => {
			refresh(page)
			refresh(pages)
		}, 5000)
		return () => clearInterval(timer)
	})
	const children = createMemo(() =>
		threads
			.filter((thread) => thread.parent === id && !thread.archived)
			.toSorted((one, other) => other.id - one.id),
	)
	const parsed = createMemo(() => parse(page().page))
	/**
	 * Working as it stands now, not as it was written: a line whose threads have all stopped leaves it, dropped when
	 * they are rows here that say where they stand, else under Idle until the page catches up.
	 */
	const sections = createMemo(() => {
		const { working = [], idle = [], ...rest } = parsed().sections
		const ours = new Set(children().map((thread) => thread.id))
		const stopped = (bullet) => named(bullet).length && !named(bullet).some(running)
		return {
			...rest,
			working: working.filter((bullet) => !stopped(bullet)),
			idle: [
				...idle,
				...working.filter(
					(bullet) => stopped(bullet) && !named(bullet).every((thread) => ours.has(thread.id)),
				),
			],
		}
	})
	const groups = createMemo(() => {
		const all = pages()
		const self = threads.find((thread) => thread.id === id)
		return GROUPS.map((group) => {
			const rows = children().filter((thread) => groupOf(thread, all[thread.id]) === group.key)
			const bullets = sections()[group.key] ?? []
			// Working's dot says what its threads, and this thread itself, are doing now: working, else blocked, else still
			const now = [self, ...rows].map((thread) => thread?.status)
			const state =
				group.key !== 'working'
					? group.state
					: (['working', 'blocked'].find((status) => now.includes(status)) ?? '')
			return {
				...group,
				state,
				threads: rows,
				text: bullets.join('\n').trim(),
				count: rows.length + bullets.length,
			}
		}).filter((group) => group.count)
	})
	const [writing, setWriting] = createSignal(false)
	const rewrite = async () => {
		setWriting(true)
		try {
			await api(`/api/threads/${id}/overview`, {})
			refresh(page)
		} catch (error) {
			report(error)
		} finally {
			setWriting(false)
		}
	}
	return html`
		<aside class="side overview" aria-label="Overview">
			<${Panes}
				title="Overview"
				head=${html`<${PageTabs} id=${id} />`}
				actions=${html`<button
					type="button"
					class="ghost small"
					aria-label=${() => (writing() || page().writing ? 'Writing the page' : 'Write it now')}
					title=${() => (writing() || page().writing ? 'Writing…' : 'Write the page now')}
					disabled=${() => writing()}
					onClick=${(_event) => rewrite()}
				>
					<${Show}
						when=${() => writing() || page().writing}
						fallback=${html`<${Icon} name="again" />`}
					>
						<${Dot} state="working" />
					<//>
				</button>`}
				onClose=${(_event) => openSide(id, null)}
			>
				<${Show}
					when=${() => parsed().summary}
					fallback=${html`<p class="mute">
						${() =>
							page().writing
								? 'Writing the page…'
								: 'No page yet. It is written after the next answer, or now with ↻.'}
					</p>`}
				>
					<p class="summary">${() => parsed().summary}</p>
				<//>
				<${For} each=${groups}>
					${(group) => html`
						<details
							class=${() => group.key}
							open=${group.key === 'waiting' || (group.key !== 'done' && group.count <= FOLDED)}
						>
							<summary>
								<h3>
									<${Show}
										when=${() => group.check}
										fallback=${html`<${Dot} state=${() => group.state} />`}
									>
										<${Icon} name="check" />
									<//>
									${() => `${group.label} · ${group.count}`}
								</h3>
							</summary>
							<${Show} when=${() => group.text}>
								<${Page} text=${() => group.text} thread=${id} />
							<//>
							<${Show} when=${() => group.threads.length}>
								<ul class="thread-family">
									<${For} each=${() => group.threads}>
										${(thread) => html`
											<li title=${() => thread.title}>
												<a
													class="row"
													href=${() => hrefOf(thread.id)}
													onClick=${(event) => followThread(event, thread.id)}
												>
													<${Dot} state=${() => thread.status} />
													<span>
														${() => thread.title}
														<small>${() => pages()[thread.id]?.summary ?? ''}</small>
													</span>
												</a>
											</li>
										`}
									<//>
								</ul>
							<//>
						</details>
					`}
				<//>
				<${Show} when=${() => page().writtenAt}>
					<p class="mute">
						<small
							>${() =>
								`From messages 0 to ${page().through - 1}, ${new Date(page().writtenAt).toLocaleString()}`}</small
						>
					</p>
				<//>
			<//>
		</aside>
	`
}

/** The page's markdown; a link to a message scrolls the thread beside it there */
const Page = (props) => html`
	<div
		class="body markdown"
		innerHTML=${() => markdown(props.text, threadLink)}
		onClick=${(event) => {
			const link = event.target.closest('a')
			if (link?.dataset.thread) return followThread(event, Number(link.dataset.thread))
			const at = link?.getAttribute('href')?.match(/^#message-(\d+)$/)?.[1]
			if (!at) return
			event.preventDefault()
			const rows = document.querySelectorAll(
				`.thread[data-thread="${props.thread}"] li[data-message]`,
			)
			const row = [...rows].find((row) => row.dataset.message === at)
			row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
			row?.classList.add('handed')
			setTimeout(() => row?.classList.remove('handed'), 1500)
		}}
	/>
`
