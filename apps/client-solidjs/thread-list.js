/** Every thread on the server, newest first. */
import html from '@solidjs/html'
import { For } from 'solid-js'
import { current, openThread, threads } from './server.js'
import { Dot } from './dot.js'
import { RunnerList } from './runner.js'

export const ThreadList = () => html`
	<nav class="thread-list" aria-label="Threads">
		<button class=${() => ['new', { current: !current() }]} onClick=${() => openThread(null)}>
			+ New thread
		</button>
		<ul>
			<${For}
				each=${() => threads.filter((t) => !t.hidden && !threads.some((p) => p.id === t.parent))}
				fallback=${html`<li class="mute">No threads yet</li>`}
			>
				${(t) => html`
					<li
						title=${() => t.title}
						class=${() => ({ current: t.id === current() })}
						role="button"
						tabindex="0"
						onClick=${() => openThread(t.id)}
						onKeyDown=${(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								openThread(t.id)
							}
						}}
					>
						<${Dot} state=${() => t.status} />
						<span>${() => t.title || 'untitled'}</span>
					</li>
				`}
			<//>
		</ul>
		<${RunnerList} />
	</nav>
`
