/** The web client, in Solid: threads and their composer. */
import html from '@solidjs/html'
import { render } from '@solidjs/web'
import { Errored, For, Loading } from 'solid-js'
import { connected, current, family, threads, titleOf } from './server.js'
import { Dot } from './dot.js'
import { ThreadList } from './thread-list.js'
import { Thread } from './thread.js'

const Client = () => html`
	<${Errored}
		fallback=${(error, retry) => html`<p class="mute">${() => String(error())} <button onClick=${retry}>Retry</button></p>`}
	>
		<${Loading} fallback=${html`<p class="mute">Asking for threads…</p>`}>
			<header class="app-bar">
				<button
					class="round"
					type="button"
					aria-label="All threads"
					onClick=${() => document.body.classList.toggle('list')}
				>
					←
				</button>
				<button class="thread-pill" type="button">
					<${Dot} state=${() => threads.find((t) => t.id === current())?.status} /><span
						>${() => (current() ? titleOf(current()) : 'New thread')}</span
					>
				</button>
			</header>
			<div class="system">
				<div class=${() => ['node', 'server', { off: !connected() }]}>
					<b><${Dot} state=${() => (connected() ? 'on' : '')} />Server</b>
					<div class="body">
						<${ThreadList} />
						<div class="threads">
							<${For} each=${() => family()}>${(id) => html`<${Thread} id=${() => id} />`}<//>
						</div>
					</div>
				</div>
			</div>
		<//>
	<//>
`

render(Client, document.getElementById('stage'))
