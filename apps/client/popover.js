/** Popovers sit above their button on desktop (below, when only there they fit), its left edge on the button's, or its right edge when `end` says so or it wouldn't fit; on phones they become bottom sheets, unless `sheet` is false. */
export function placePopover(panel, button, sheet = true, end = false) {
	if (sheet && matchMedia('(max-width: 700px)').matches) return panel.removeAttribute('style')
	const rect = button.getBoundingClientRect()
	const below = rect.top < panel.offsetHeight + 14 && innerHeight - rect.bottom > rect.top
	const fits = !end && rect.left + panel.offsetWidth <= innerWidth - 8
	Object.assign(panel.style, {
		transformOrigin: `${fits ? 'left' : 'right'} ${below ? 'top' : 'bottom'}`,
		left: `${Math.max(8, fits ? rect.left : rect.right - panel.offsetWidth)}px`,
		top: below ? `${rect.bottom + 6}px` : 'auto',
		bottom: below ? 'auto' : `${innerHeight - rect.top + 6}px`,
	})
}
