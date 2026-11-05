/** Just the chat, or the live system around it. */
import html from '@solidjs/html'
import { render } from '@solidjs/web'
import { createEffect, createSignal, Errored, Loading, onSettled } from 'solid-js'
import { current, drawer, newThreadTools, params, threads, titleOf } from './server.js'
import { Dot } from './dot.js'
import { System } from './system.js'
import { ThreadDetails } from './thread-details.js'
import { Tutorial } from './tutorial.js'
import { Notice } from './notice.js'

function Client() {
	const [chat, setChat] = createSignal(params.has('chat'))
	createEffect(chat, (on) => {
		document.body.classList.toggle('chat', on)
		drawer(null)
		const next = new URL(location.href)
		if (on) next.searchParams.set('chat', '')
		else next.searchParams.delete('chat')
		history.replaceState(null, '', next)
		dispatchEvent(new Event('resize'))
	})
	onSettled(() => {
		const close = (e) => {
			if (e.key === 'Escape') drawer(null)
		}
		const resize = () => drawer(null)
		const phone = matchMedia('(max-width: 700px)')
		addEventListener('keydown', close)
		phone.addEventListener('change', resize)
		return () => {
			removeEventListener('keydown', close)
			phone.removeEventListener('change', resize)
		}
	})
	return html`
		<button
			class="mode-toggle"
			type="button"
			aria-pressed=${() => String(chat())}
			title=${() => (chat() ? 'Back to the story' : '')}
			aria-label=${() => (chat() ? 'Back to the story' : 'Just the chat')}
			onClick=${() => setChat(!chat())}
		>
			${() => (chat() ? '↑' : 'Just the chat')}
		</button>
		<${Notice} />
		<${Errored}
			fallback=${(error, retry) => html`
				<p class="mute">${() => String(error())} <button onClick=${retry}>Retry</button></p>
			`}
		>
			<${Loading} fallback=${html`<p class="mute">Asking for threads…</p>`}>
				<header class="app-bar">
					<button
						class="round"
						type="button"
						aria-label="All threads"
						onClick=${() => drawer('list')}
					>
						←
					</button>
					<button
						class=${() => [
							'thread-pill',
							{
								'hands-off': !!(current()
									? threads.find((t) => t.id === current())?.tools
									: newThreadTools()),
							},
						]}
						type="button"
						onClick=${() => drawer('side')}
					>
						<${Dot} state=${() => threads.find((t) => t.id === current())?.status} />
						<span>${() => (current() ? titleOf(current()) : 'New thread')}</span>
					</button>
				</header>
				<${ThreadDetails} />
				<${System} />
				<${Tutorial} />
			<//>
		<//>
	`
}

render(Client, document.getElementById('stage'))
