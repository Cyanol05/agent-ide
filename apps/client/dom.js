// Building the page: h makes an element, $ finds one by id, and the few things every part of the page shares.

export const $ = (id) => document.getElementById(id)
export const h = (tag, props = {}, ...children) => {
	const e = Object.assign(document.createElement(tag), props)
	e.append(...children.filter((c) => c != null && c !== false))
	return e
}

// One dot everywhere: grey when there's nothing, green when it's on, pulsing green while it works, amber when it's blocked.
export const dotClass = (state) =>
	`dot${state === 'on' ? ' on' : state === 'working' ? ' working' : state === 'blocked' ? ' blocked' : ''}`

export const phone = matchMedia('(max-width: 700px)')
// On a phone: one drawer open at a time, all threads on the left ('list') or this thread's details on the right ('side').
export const drawer = (name) => {
	document.body.classList.toggle('list', name === 'list')
	document.body.classList.toggle('side', name === 'side')
}
// A popover opens next to what opened it: above it on a big screen, as a sheet from the bottom on a phone.
export function placePopover(pop, from) {
	if (phone.matches) return void pop.removeAttribute('style')
	const r = from.getBoundingClientRect()
	Object.assign(pop.style, {
		left: `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`,
		top: 'auto',
		bottom: `${innerHeight - r.top + 6}px`,
	})
}
