/** Popovers sit above their button on desktop (below, when only there they fit), and become bottom sheets on phones. */
export function placePopover(panel, button) {
	if (matchMedia('(max-width: 700px)').matches) return panel.removeAttribute('style')
	const r = button.getBoundingClientRect()
	// Above it, unless it fits only below
	const below = r.top < panel.offsetHeight + 14 && innerHeight - r.bottom > r.top
	Object.assign(panel.style, {
		left: `${Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8))}px`,
		top: below ? `${r.bottom + 6}px` : 'auto',
		bottom: below ? 'auto' : `${innerHeight - r.top + 6}px`,
	})
}
