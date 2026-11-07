/** A list and its detail share one frame. The list stays mounted, keeping its scroll and draft. */
import html from '@solidjs/html'
import { createEffect, createMemo, onSettled, Show } from 'solid-js'

/** Controlled by open/onBack; detail and actions are ordinary content, not another popup. */
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
					<span aria-hidden="true"></span>
					<h2>${() => props.title}</h2>
					${() => props.close}
				</header>
				<div class="pane-body">${() => props.children}</div>
			</section>
			<${Show} when=${() => props.open}>
				<section class="pane detail" aria-label=${() => props.detailTitle}>
					<header>
						<button
							type="button"
							aria-label=${() => `Back to ${props.title}`}
							ref=${(element) => (back = element)}
							onClick=${(event) => props.onBack(event)}
						>
							<span aria-hidden="true">←</span>
						</button>
						<h2>${() => props.title}</h2>
						${() => props.actions}
					</header>
					<div class="pane-body">${() => props.detail}</div>
				</section>
			<//>
		</div>
	`
}
