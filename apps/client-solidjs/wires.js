/** Wires between DOM elements; layout is measured after Solid has placed the nodes. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, onSettled } from 'solid-js'

const directions = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }
const point = (rect, side, at = 0.5) => {
	const horizontal = side === 'left' || side === 'right'
	const size = horizontal ? rect.height : rect.width
	const offset = at === 'to' ? size / 2 : at >= 0 && at <= 1 ? at * size : at < 0 ? size + at : at
	return horizontal
		? [side === 'left' ? rect.left : rect.right, rect.top + offset]
		: [rect.left + offset, side === 'top' ? rect.top : rect.bottom]
}
/** A wire must not reach through a clipped or scrolled-away endpoint. */
function visible(node) {
	if (!node?.isConnected) return false
	let { left, right, top, bottom, width, height } = node.getBoundingClientRect()
	if (!width || !height) return false
	for (let parent = node.parentElement; parent; parent = parent.parentElement) {
		const style = getComputedStyle(parent),
			rect = parent.getBoundingClientRect()
		if (style.overflowX !== 'visible') {
			left = Math.max(left, rect.left + parent.clientLeft)
			right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth)
		}
		if (style.overflowY !== 'visible') {
			top = Math.max(top, rect.top + parent.clientTop)
			bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight)
		}
	}
	return right > left && bottom > top
}

export function Wires(props) {
	const [paths, setPaths] = createSignal([])
	let svg,
		sizes,
		changes,
		frame = 0,
		connections = [],
		observed = new Set()
	const draw = () => {
		frame = 0
		if (!svg?.isConnected) return
		const container = svg.parentElement,
			origin = svg.getBoundingClientRect()
		const nodes = new Set([container]),
			next = []
		for (const edge of connections) {
			const from = container.querySelector(edge.from),
				to = container.querySelector(edge.to)
			for (let node of [from, to]) for (; node; node = node.parentElement) nodes.add(node)
			if (!visible(from) || !visible(to)) continue
			const start = point(from.getBoundingClientRect(), edge.fromSide, edge.fromAt)
			const end = point(to.getBoundingClientRect(), edge.toSide, edge.toAt)
			if (edge.fromAt === 'to') {
				const axis = edge.fromSide === 'left' || edge.fromSide === 'right' ? 1 : 0
				start[axis] = end[axis]
			}
			const control = (p, side) =>
				directions[side].map((d, i) => p[i] + d * Math.max(12, Math.abs(end[i] - start[i]) / 2))
			const coords = (p) => `${p[0] - origin.left},${p[1] - origin.top}`
			next.push({
				d:
					`M${coords(start)} C${coords(control(start, edge.fromSide))} ` +
					`${coords(control(end, edge.toSide))} ${coords(end)}`,
				state: edge.state,
			})
		}
		for (const node of observed) if (!nodes.has(node)) sizes.unobserve(node)
		for (const node of nodes) if (!observed.has(node)) sizes.observe(node)
		observed = nodes
		setPaths(next)
	}
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(draw)
	}
	createEffect(
		() => props.connections,
		(next) => {
			connections = next
			schedule()
		},
	)
	onSettled(() => {
		sizes = new ResizeObserver(schedule)
		changes = new MutationObserver((records) => {
			if (records.some(({ target }) => !svg.contains(target))) schedule()
		})
		changes.observe(svg.parentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
		addEventListener('resize', schedule)
		document.addEventListener('scroll', schedule, true)
		schedule()
		return () => {
			cancelAnimationFrame(frame)
			sizes.disconnect()
			changes.disconnect()
			removeEventListener('resize', schedule)
			document.removeEventListener('scroll', schedule, true)
		}
	})
	return html`
		<svg
			class="wires"
			aria-hidden="true"
			ref=${(el) => {
				svg = el
			}}
			style="
				position: absolute; inset: 0; width: 100%; height: 100%;
				pointer-events: none; overflow: visible; fill: none;
			"
		>
			<${For} each=${() => paths()} keyed=${false}>${(path) => html`
				<path
					d=${() => path().d}
					class=${() => [path().state]}
				/>
			`}<//>
		</svg>
	`
}
