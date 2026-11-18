/**
 * A thread's overview, as a column beside it: a short recap of where the thread stands, its links scrolling the
 * thread to the message behind a claim. The column being open is what keeps the recap written; while it's rewritten,
 * the refresh button's icon pulses.
 */
import html from '@solidjs/html'
import { createMemo, createSignal, onSettled, refresh, Show, untrack } from 'solid-js'
import { openSide, PageTabs } from './side.js'
import { Panes } from './panes.js'
import { Icon } from './icons.js'
import { api, followThread, loadEarlier } from './server.js'
import { markdown } from './markdown.js'
import { report } from './notice.js'
import { links } from './thread.js'

export function Overview(props) {
	// One thread for this column's whole life
	const id = untrack(() => props.id)
	// Fetched with ?open, so the server knows someone's looking: a page behind catches up, and answers keep it current
	const page = createMemo(() => api(`/api/threads/${id}/overview?open`))
	onSettled(() => {
		const timer = setInterval(() => refresh(page), 5000)
		return () => clearInterval(timer)
	})
	const [asked, setAsked] = createSignal(false)
	const writing = () => asked() || page().writing
	const rewrite = async () => {
		setAsked(true)
		try {
			await api(`/api/threads/${id}/overview`, {})
			refresh(page)
		} catch (error) {
			report(error)
		} finally {
			setAsked(false)
		}
	}
	return html`
		<aside class="side overview" aria-label="Overview">
			<${Panes}
				title="Overview"
				head=${html`<${PageTabs} id=${id} />`}
				actions=${html`<button
					type="button"
					class=${() => (writing() ? 'ghost small writing' : 'ghost small')}
					aria-label=${() => (writing() ? 'Writing the recap' : 'Write it now')}
					title=${() => (writing() ? 'Writing…' : 'Write the recap now')}
					disabled=${() => asked()}
					onClick=${(_event) => rewrite()}
				>
					<${Icon} name="again" />
				</button>`}
				onClose=${(_event) => openSide(id, null)}
			>
				<${Show}
					when=${() => page().page}
					fallback=${html`<p class="mute">
						${() =>
							page().writing
								? 'Writing the recap…'
								: 'No recap yet. It is written after the next answer, or now with ↻.'}
					</p>`}
				>
					<${Page} text=${() => page().page} thread=${id} />
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
		innerHTML=${() => markdown(props.text, links)}
		onClick=${(event) => {
			const link = event.target.closest('a')
			if (link?.dataset.thread) return followThread(event, Number(link.dataset.thread))
			const at = link?.getAttribute('href')?.match(/^#message-(\d+)$/)?.[1]
			if (!at) return
			event.preventDefault()
			// Messages count from the thread's first, so the thread brings all of them before one is found
			loadEarlier(props.thread, true).then(() =>
				requestAnimationFrame(() => {
					const rows = document.querySelectorAll(
						`.thread[data-thread="${props.thread}"] li[data-message]`,
					)
					const row = [...rows].find((row) => row.dataset.message === at)
					row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
					row?.classList.add('handed')
					setTimeout(() => row?.classList.remove('handed'), 1500)
				}),
			)
		}}
	/>
`
