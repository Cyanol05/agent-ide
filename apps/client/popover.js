/** Popovers sit above their button on desktop (below, when only there they fit), and become bottom sheets on phones. */
export function placePopover(panel, button) {
	if (matchMedia('(max-width: 700px)').matches) return panel.removeAttribute('style')
	const rect = button.getBoundingClientRect()
	// Above it, unless it fits only below
	const below = rect.top < panel.offsetHeight + 14 && innerHeight - rect.bottom > rect.top
	Object.assign(panel.style, {
		left: `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`,
		top: below ? `${rect.bottom + 6}px` : 'auto',
		bottom: below ? 'auto' : `${innerHeight - rect.top + 6}px`,
	})
}
