/** What went wrong, above the active composer's input; goes by itself. */
import html from '@solidjs/html'
import { createEffect, createRoot, createSignal, Show } from 'solid-js'

const [notice, setNotice] = createRoot(() => createSignal('', { equals: false }))
export const report = (error) => setNotice(error?.message ?? String(error))

export function Notice() {
	createEffect(notice, (text) => {
		if (!text) return
		const timer = setTimeout(() => setNotice(''), 6000)
		return () => clearTimeout(timer)
	})
	return html`
		<${Show} when=${notice}>
			<p class="notice" role="alert">
				<span>${() => notice()}</span>
				<button
					type="button"
					class="ghost small"
					aria-label="Dismiss"
					onClick=${(_e) => setNotice('')}
				>
					×
				</button>
			</p>
		<//>
	`
}
