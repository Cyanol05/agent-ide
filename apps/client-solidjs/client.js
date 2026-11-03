/** Just the chat, or the live system around it. */
import html from '@solidjs/html'
import { render } from '@solidjs/web'
import { createEffect, createSignal, Errored, Loading, onSettled } from 'solid-js'
import { current, params, threads, titleOf } from './server.js'
import { Dot } from './dot.js'
import { System } from './system.js'

function Client() {
	const [chat, setChat] = createSignal(params.has('chat'))
	createEffect(chat, (on) => {
		document.body.classList.toggle('chat', on)
		document.body.classList.remove('list')
		const next = new URL(location.href)
		if (on) next.searchParams.set('chat', '')
		else next.searchParams.delete('chat')
		history.replaceState(null, '', next)
		dispatchEvent(new Event('resize'))
	})
	onSettled(() => {
		const close = (e) => { if (e.key === 'Escape') document.body.classList.remove('list') }
		const resize = () => document.body.classList.remove('list')
		const phone = matchMedia('(max-width: 700px)')
		addEventListener('keydown', close)
		phone.addEventListener('change', resize)
		return () => { removeEventListener('keydown', close); phone.removeEventListener('change', resize) }
	})
	return html`
		<button class="mode-toggle" type="button" aria-pressed=${() => String(chat())} onClick=${() => setChat(!chat())}>
			${() => chat() ? 'With the system' : 'Just the chat'}
		</button>
		<${Errored} fallback=${(error, retry) => html`<p class="mute">${() => String(error())} <button onClick=${retry}>Retry</button></p>`}>
			<${Loading} fallback=${html`<p class="mute">Asking for threads…</p>`}>
				<header class="app-bar">
					<button class="round" type="button" aria-label="All threads" onClick=${() => document.body.classList.toggle('list')}>←</button>
					<button class="thread-pill" type="button">
						<${Dot} state=${() => threads.find((t) => t.id === current())?.status} />
						<span>${() => current() ? titleOf(current()) : 'New thread'}</span>
					</button>
				</header>
				<${System} />
			<//>
		<//>
	`
}

render(Client, document.getElementById('stage'))
