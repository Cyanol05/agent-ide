/** The web client, in Solid: so far, the server and its threads */
import html from '@solidjs/html'
import { render } from '@solidjs/web'
import { Errored, Loading } from 'solid-js'
import { connected } from './server.js'
import { Dot } from './dot.js'
import { ThreadList } from './thread-list.js'

const Client = () => html`
	<div class="system">
		<div class=${() => ['node', 'server', { off: !connected() }]}>
			<b><${Dot} state=${() => (connected() ? 'on' : '')} />Server</b>
			<div class="body">
				<${Errored} fallback=${(error) => html`<p class="mute">${() => String(error())}</p>`}>
					<${Loading} fallback=${html`<p class="mute">Asking for threads…</p>`}>
						<${ThreadList} />
					<//>
				<//>
			</div>
		</div>
	</div>
`

render(Client, document.getElementById('stage'))
