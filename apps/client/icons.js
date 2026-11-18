/** The client's icons: one set of strokes on a 24-unit grid, drawn in the button's own colour and sized by base.css's `svg.icon`, so they weigh the same wherever they sit */
import html from '@solidjs/html'

const paths = {
	up: 'M12 19V5M6 11l6-6 6 6',
	back: 'M19 12H5M11 6l-6 6 6 6',
	plus: 'M12 5v14M5 12h14',
	close: 'M6 6l12 12M18 6L6 18',
	next: 'M9 6l6 6-6 6',
	check: 'M5 12l5 5 9-10',
	again: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
	// Lucide's gear, its hub drawn as two arcs so it stays one path
	settings:
		'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
}

export const Icon = (props) =>
	html`<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d=${() => paths[props.name]} />
	</svg>`
