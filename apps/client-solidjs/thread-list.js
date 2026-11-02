/** Every thread on the server, one row each */
import html from '@solidjs/html'
import { For } from 'solid-js'
import { threads } from './server.js'
import { Dot } from './dot.js'

export const ThreadList = () => html`
	<nav class="thread-list">
		<ul>
			<${For} each=${threads} fallback=${html`<li class="mute">No threads yet</li>`}>
				${(t) => html`
					<li title=${() => t.title}>
						<${Dot} state=${() => t.status} />
						<span>${() => t.title || 'untitled'}</span>
					</li>
				`}
			<//>
		</ul>
	</nav>
`
