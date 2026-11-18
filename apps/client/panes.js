/**
 * A thing you open: its top page, a page opened from it that leads back, and a close on both. The popovers and the side
 * column share it. The top page stays mounted under the one opened over it, keeping its scroll and draft. Its head is
 * its `title`, or `head` in its place (the side column's tabs), then its `actions`.
 */
import html from '@solidjs/html'
import { Icon } from './icons.js'
import { createEffect, createMemo, onSettled, Show } from 'solid-js'

export function Panes(props) {
	let back, origin
	const opened = createMemo(() => props.open)
	// A new choice can re-read open without changing it; only entering/leaving moves focus.
	createEffect(opened, (open) => {
		if (open) origin = document.activeElement
		onSettled(() => {
			if (open) back?.focus({ preventScroll: true })
			else if (origin?.isConnected) origin.focus({ preventScroll: true })
		})
	})
	const close = () =>
		html`<button
			type="button"
			class="ghost small close"
			aria-label="Close"
			onClick=${(event) => props.onClose(event)}
		>
			<${Icon} name="close" />
		</button>`
	return html`
		<div
			class="panes"
			onKeyDown=${(event) => {
				if (event.key !== 'Escape' || !props.open) return
				event.preventDefault()
				event.stopPropagation()
				props.onBack()
			}}
		>
			<section
				class="pane"
				inert=${() => props.open}
				aria-hidden=${() => (props.open ? 'true' : undefined)}
				style=${() => ({ visibility: props.open ? 'hidden' : 'visible' })}
			>
				<header>
					${() => props.head ?? html`<h2>${() => props.title}</h2>`} ${() => props.actions}
					${close()}
				</header>
				<div class="pane-body">${() => props.children}</div>
			</section>
			<${Show} when=${() => props.open}>
				<section class="pane detail" aria-label=${() => props.detailTitle}>
					<header>
						<button
							type="button"
							class="ghost small"
							aria-label=${() => `Back to ${props.title}`}
							ref=${(element) => (back = element)}
							onClick=${(event) => props.onBack(event)}
						>
							<${Icon} name="back" />
						</button>
						<h2>${() => props.detailTitle}</h2>
						${close()}
					</header>
					<div class="pane-body">${() => props.detail}</div>
				</section>
			<//>
		</div>
	`
}
