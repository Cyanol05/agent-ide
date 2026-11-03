/** Popovers sit above their button on desktop, and become bottom sheets on phones. */
export function placePopover(panel, button) {
	if (matchMedia('(max-width: 700px)').matches) return panel.removeAttribute('style')
	const r = button.getBoundingClientRect()
	Object.assign(panel.style, {
		left: `${Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8))}px`,
		top: 'auto',
		bottom: `${innerHeight - r.top + 6}px`,
	})
}
