/**
 * The side column beside a thread: one page at a time, its siblings as tabs (the thread's details, and Overview and
 * Canvas when their modules are on). The thread's name opens it on Details; its tabs do the rest.
 */
import html from '@solidjs/html'
import { createSignal, For, Show } from 'solid-js'
import { server } from './server.js'

const PAGES = [
	{ key: 'details', label: 'Details' },
	{ key: 'overview', label: 'Overview', title: 'Where this thread stands' },
	{ key: 'canvas', label: 'Canvas', title: "This thread's canvas" },
]
/** A thread's pages: its details always, the rest once it exists and their modules are on */
export const pagesOf = (id) =>
	PAGES.filter((page) => page.key === 'details' || (id && server().modules.includes(page.key)))

/** The page each thread's column shows; a thread with none has it closed */
const [shown, setShown] = createSignal(new Map())
export const sideOf = (id) =>
	shown().has(id)
		? (pagesOf(id).find((page) => page.key === shown().get(id)) ?? pagesOf(id)[0])
		: undefined
/** Shows a page in the thread's column, or closes it with none */
export const openSide = (id, key) =>
	setShown((pages) => {
		const next = new Map(pages)
		if (key) next.set(id, key)
		else next.delete(id)
		return next
	})
export const toggleSide = (id, key) => openSide(id, sideOf(id)?.key === key ? null : key)

/** The column's head: a page's name, or the tabs between its pages */
export const PageTabs = (props) => html`
	<${Show}
		when=${() => pagesOf(props.id).length > 1}
		fallback=${html`<h2>${() => sideOf(props.id)?.label}</h2>`}
	>
		<nav class="tabs">
			<${For} each=${() => pagesOf(props.id)}>
				${(page) => html`
					<button
						type="button"
						class="ghost small"
						aria-pressed=${() => String(sideOf(props.id)?.key === page.key)}
						onClick=${(_event) => openSide(props.id, page.key)}
					>
						${page.label}
					</button>
				`}
			<//>
		</nav>
	<//>
`
