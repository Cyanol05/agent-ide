/** Just the chat, or the live system around it. */
import html from '@solidjs/html'
import { render } from '@solidjs/web'
import { createEffect, createSignal, Errored, Loading, onSettled } from 'solid-js'
import { colorOf, current, drawer, homeBot, params, threads, titleOf } from './server.js'
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
		const close = (event) => {
			if (event.key === 'Escape') drawer(null)
		}
		const resize = () => drawer(null)
		const phone = matchMedia('(max-width: 700px)')
		// iOS Safari ignores interactive-widget: the keyboard shrinks only the visual viewport, so the stage follows that.
		const viewport = window.visualViewport
		const fit = () => {
			document.documentElement.style.setProperty('--visual-height', `${viewport.height}px`)
			if (viewport.offsetTop) scrollTo(0, 0)
		}
		// An installed app on iOS sometimes misses the resize as the keyboard slides in, so focus follows the viewport until it holds still.
		let settling = 0
		const settle = () => {
			cancelAnimationFrame(settling)
			let last = -1
			let still = 0
			let frames = 0
			const step = () => {
				fit()
				still = viewport.height === last ? still + 1 : 0
				last = viewport.height
				if (still < 10 && ++frames < 120) settling = requestAnimationFrame(step)
			}
			step()
		}
		viewport?.addEventListener('resize', fit)
		viewport?.addEventListener('scroll', fit)
		if (viewport) addEventListener('focusin', settle)
		if (viewport) addEventListener('focusout', settle)
		addEventListener('keydown', close)
		phone.addEventListener('change', resize)
		return () => {
			removeEventListener('keydown', close)
			viewport?.removeEventListener('resize', fit)
			viewport?.removeEventListener('scroll', fit)
			removeEventListener('focusin', settle)
			removeEventListener('focusout', settle)
			cancelAnimationFrame(settling)
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
			${() =>
				chat()
					? html`<svg
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 19V5M6 11l6-6 6 6" />
						</svg>`
					: 'Just the chat'}
		</button>
		<${Notice} />
		<${Errored}
			fallback=${(error, retry) => html`
				<p class="mute">${() => String(error())} <button onClick=${retry}>Retry</button></p>
			`}
		>
			<${Loading}>
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
						class="thread-pill"
						type="button"
						style=${() => colorOf(homeBot(current())?.name ?? '')}
						onClick=${() => drawer('side')}
					>
						<${Dot} state=${() => threads.find((thread) => thread.id === current())?.status} />
						<span>${() => (current() ? titleOf(current()) : 'New thread')}</span>
					</button>
				</header>
				<${ThreadDetails} />
				<${System} />
				<${Tutorial} story=${() => !chat()} />
			<//>
		<//>
	`
}

render(Client, document.getElementById('stage'))
