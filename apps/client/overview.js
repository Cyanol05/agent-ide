/**
 * A thread's overview, as a column beside it: its page's first line, then its topics and the threads it started together,
 * grouped by where they stand, waiting on you first, each thread with its own page's first line. Where each child stands
 * comes from the thread list; only the lines and the page are the model's.
 */
import html from '@solidjs/html'
import { createMemo, createSignal, For, onSettled, refresh, Show, untrack } from 'solid-js'
import { Icon } from './icons.js'
import { Dot, Switch } from './dot.js'
import { api, followThread, hrefOf, threads } from './server.js'
import { markdown } from './markdown.js'
import { report } from './notice.js'
import { threadLink } from './thread.js'

/** The threads whose overview column is open */
const [shown, setShown] = createSignal(new Set())
export const overviewOpen = (id) => shown().has(id)
export const toggleOverview = (id) => {
	setPushed((ids) => without(ids, id))
	setShown((ids) => (ids.has(id) ? without(ids, id) : new Set([...ids, id])))
}
const without = (ids, id) => new Set([...ids].filter((other) => other !== id))

/**
 * The column is one page at a time, like a phone's: the thread's details push onto the overview in its place, and back
 * pops them; with no overview open they are the column's only page. The threads whose column shows their details.
 */
const [pushed, setPushed] = createSignal(new Set())
export const detailsPushed = (id) => pushed().has(id)
export const pushDetails = (id) =>
	setPushed((ids) => (ids.has(id) ? without(ids, id) : new Set([...ids, id])))
export const popDetails = (id) => setPushed((ids) => without(ids, id))

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
/** A page as its first line and each section's bullets, by group */
function parse(page) {
	const [summary = '', ...rest] = (page ?? '').split('\n')
	const sections = {}
	let at
	for (const line of rest) {
		const heading = line.match(/^##\s+(.*?)\s*$/)?.[1]
		if (heading !== undefined)
			at = GROUPS.find((group) => group.label.toLowerCase() === heading.toLowerCase())?.key
		else if (at) sections[at] = `${sections[at] ?? ''}${line}\n`
	}
	return { summary: summary.trim(), sections }
}

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
	const groups = createMemo(() => {
		const all = pages()
		const { sections } = parsed()
		return GROUPS.map((group) => {
			const threads = children().filter((thread) => groupOf(thread, all[thread.id]) === group.key)
			const text = sections[group.key]?.trim() ?? ''
			const count = threads.length + (text.match(/^\s*[-*] /gm)?.length ?? 0)
			return { ...group, threads, text, count }
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
		<aside class="overview" aria-label="Overview">
			<header class="page-head">
				<h2>Overview</h2>
				<button
					type="button"
					class="ghost small"
					aria-label=${() => (writing() || page().writing ? 'Writing the page' : 'Write it now')}
					title=${() => (writing() || page().writing ? 'Writing…' : 'Write the page now')}
					disabled=${() => writing() || !page().on}
					onClick=${(_event) => rewrite()}
				>
					<${Show}
						when=${() => writing() || page().writing}
						fallback=${html`<${Icon} name="again" />`}
					>
						<${Dot} state="working" />
					<//>
				</button>
				<button
					type="button"
					class="ghost small close"
					aria-label="Close the overview"
					onClick=${(_event) => toggleOverview(id)}
				>
					<${Icon} name="close" />
				</button>
			</header>
			<${Show}
				when=${() => parsed().summary}
				fallback=${html`<p class="mute">
					${() =>
						page().on
							? page().writing
								? 'Writing the page…'
								: 'No page yet. It is written after the next answer, or now with ↻.'
							: 'This thread keeps no page.'}
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
			<${Switch}
				on=${() => page().on}
				title="Whether this thread keeps a page"
				onToggle=${(on) =>
					api(`/api/threads/${id}/overview`, { on })
						.then(() => refresh(page))
						.catch(report)}
				>Keep a page<//
			>
			<${Show} when=${() => page().writtenAt}>
				<p class="mute">
					<small
						>${() =>
							`From messages 0 to ${page().through - 1}, ${new Date(page().writtenAt).toLocaleString()}`}</small
					>
				</p>
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
