/** The client, server, threads and runners, with the routes between them. */
import html from '@solidjs/html'
import { createEffect, createMemo, For, Loading, Show } from 'solid-js'
import { columns, connected, current, runners, server, threads, url } from './server.js'
import { rowOf } from './agent.js'
import { recipients } from './composer.js'
import { Dot } from './dot.js'
import { Runner } from './runner.js'
import { Thread } from './thread.js'
import { Canvas, offerToHost } from './canvas.js'
import { Overview } from './overview.js'
import { sideOf } from './side.js'
import { DetailsPage } from './thread-details.js'
import { ThreadList } from './thread-list.js'
import { Wires } from './wires.js'

export function System() {
	// With the canvas on, this page can bring up an editor for an agent when no tab shows that canvas
	createEffect(
		() => server().modules.includes('canvas'),
		(on) => (on ? offerToHost() : undefined),
	)
	const shown = createMemo(() => threads.filter((thread) => columns().includes(thread.id)))
	const agents = createMemo(() =>
		shown().flatMap((thread) => thread.agents.map((agent) => ({ ...agent, thread: thread.id }))),
	)
	const connections = createMemo(() => {
		const asking = recipients()
		const down = { fromSide: 'bottom', toSide: 'top', fromAt: 'to' }
		const row = (to) =>
			`[data-runner="${CSS.escape(to.runner)}"] [data-agent="${CSS.escape(rowOf(to))}"]`
		const state = (status) => (['working', 'blocked'].includes(status) ? status : '')
		/** @type {{ from: string, to: string, fromSide: string, toSide: string, fromAt: number | string, toAt: number, state: string }[]} */
		const edges = [
			{
				from: '.client',
				to: '.server',
				fromSide: 'right',
				toSide: 'left',
				fromAt: 18,
				toAt: 18,
				state: connected() ? '' : 'off',
			},
		]
		const reached = new Set([
			...asking.map((to) => to.runner),
			...agents().map((agent) => agent.to.runner),
		])
		for (const runner of runners)
			if (!reached.has(runner.name))
				edges.push({
					...down,
					from: '.server',
					to: `[data-runner="${CSS.escape(runner.name)}"]`,
					toAt: 40,
					state: connected() && runner.online ? '' : 'off',
				})
		for (const agent of agents()) {
			if (agent.thread === current() && asking.some((to) => rowOf(to) === rowOf(agent.to))) continue
			edges.push({
				...down,
				from: `[data-thread="${agent.thread}"]`,
				to: row(agent.to),
				toAt: -20,
				state: state(agent.status),
			})
		}
		for (const to of asking)
			edges.push({
				...down,
				from: '.thread.current .pick',
				to: row(to),
				toAt: -20,
				state:
					state(
						agents().find((agent) => agent.thread === current() && rowOf(agent.to) === rowOf(to))
							?.status,
					) || 'route',
			})
		return edges
	})
	return html`
		<div class="system">
			<${Wires} connections=${() => connections()} />
			<div class="node client"><b>Client</b></div>
			<div class=${() => ['node', 'server', { off: !connected() }]}>
				<b><${Dot} state=${() => (connected() ? 'on' : '')} />Server</b>
				<small><code>${() => url}</code></small>
				<div class="body">
					<${ThreadList} />
					<${ListEdge} />
					<div class="threads">
						<${For} each=${() => columns()}
							>${(id) => html`
								<${Thread} id=${() => id} />
								<${Show} when=${() => sideOf(id)}>
									<${SideEdge} />
									<${Show} when=${() => sideOf(id)?.key} keyed>
										${(key) =>
											key === 'canvas'
												? html`<${Canvas} id=${id} />`
												: key === 'overview'
													? html`<${Loading}
															fallback=${html`<aside class="side"><p class="mute">Reading the page…</p></aside>`}
														>
															<${Overview} id=${id} />
														<//>`
													: html`<${DetailsPage} id=${id} />`}
									<//>
									<${SideEdge} after />
								<//>
							`}<//
						>
					</div>
				</div>
			</div>
			<div class="runners">
				<${For} each=${() => runners}
					>${(runner) => html` <${Runner} runner=${() => runner} agents=${() => agents()} /> `}<//
				>
			</div>
		</div>
	`
}

function ListEdge() {
	const fit = (px) => Math.round(Math.min(Math.max(px, 160), Math.min(640, innerWidth / 2)))
	const list = (el) => el.parentElement.querySelector('.thread-list')
	return Edge({
		label: 'Thread list width',
		width: (edge) => list(edge).offsetWidth,
		drag: (edge) => {
			const left = list(edge).getBoundingClientRect().left
			return (pointer) => listWidth.set(fit(pointer.clientX - left))
		},
		set: (px) => listWidth.set(px && fit(px)),
		grow: 1,
		edge: 'list-edge',
	})
}

/** The side column's edges drag the same way, either side of it: the overview, details and canvas share its width. */
function SideEdge({ after }) {
	const fit = (px) => Math.round(Math.min(Math.max(px, 288), innerWidth * 0.7))
	const page = (el) => (after ? el.previousElementSibling : el.nextElementSibling)
	return Edge({
		label: 'Side column width',
		width: (edge) => page(edge).offsetWidth,
		drag: (edge) => {
			const rect = page(edge).getBoundingClientRect()
			const wanted = (pointer) =>
				after ? pointer.clientX - rect.left : rect.right - pointer.clientX
			// The threads beside it keep their own least width, so the page stops where it would squeeze one.
			return (pointer) => {
				sideWidth.set(fit(wanted(pointer)))
				sideWidth.set(Math.min(fit(wanted(pointer)), page(edge).offsetWidth))
			}
		},
		set: (px) => sideWidth.set(px && fit(px)),
		grow: after ? 1 : -1,
		edge: 'side-edge',
	})
}

function Edge({ label, width, drag, set, grow, edge: name }) {
	return html`
		<div
			class=${name}
			role="separator"
			aria-orientation="vertical"
			aria-label=${label}
			tabindex="0"
			title="Drag to resize; double-click to reset"
			onPointerDown=${(event) => {
				const edge = event.currentTarget
				edge.setPointerCapture(event.pointerId)
				const move = drag(edge)
				const up = () => {
					edge.removeEventListener('pointermove', move)
					edge.removeEventListener('pointerup', up)
					document.body.classList.remove('resizing')
				}
				edge.addEventListener('pointermove', move)
				edge.addEventListener('pointerup', up)
				document.body.classList.add('resizing')
				event.preventDefault()
			}}
			onDblClick=${(_event) => set(null)}
			onKeyDown=${(event) => {
				const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key]
				if (!step) return
				event.preventDefault()
				set(width(event.currentTarget) + grow * step)
			}}
		></div>
	`
}

/** A dragged width stays here, on this device; a double-click puts it back. */
function width(key, property) {
	const apply = (px) => {
		if (px) document.documentElement.style.setProperty(property, `${px}px`)
		else document.documentElement.style.removeProperty(property)
	}
	try {
		apply(Number(localStorage.getItem(key)))
	} catch {}
	return {
		set(px) {
			apply(px)
			try {
				if (px) localStorage.setItem(key, String(px))
				else localStorage.removeItem(key)
			} catch {}
		},
	}
}
const listWidth = width('ade.list-width', '--list-width')
const sideWidth = width('ade.side-width', '--side-width')
