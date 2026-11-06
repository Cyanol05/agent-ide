/** The client, server, threads and runners, with the routes between them. */
import html from '@solidjs/html'
import { createMemo, For } from 'solid-js'
import { columns, connected, current, runners, threads, url } from './server.js'
import { rowOf } from './agent.js'
import { recipients } from './composer.js'
import { Dot } from './dot.js'
import { Runner } from './runner.js'
import { Thread } from './thread.js'
import { ThreadList } from './thread-list.js'
import { Wires } from './wires.js'

export function System() {
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
						<${For} each=${() => columns()}>${(id) => html`<${Thread} id=${() => id} />`}<//>
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

/** The chat's thread list is as wide as you drag it, here, on this device; a double-click puts it back. */
const WIDTH = 'agent-ide.list-width'
const setWidth = (px) => {
	if (px) document.documentElement.style.setProperty('--list-width', `${px}px`)
	else document.documentElement.style.removeProperty('--list-width')
	try {
		if (px) localStorage.setItem(WIDTH, String(px))
		else localStorage.removeItem(WIDTH)
	} catch {}
}
try {
	const saved = Number(localStorage.getItem(WIDTH))
	if (saved) document.documentElement.style.setProperty('--list-width', `${saved}px`)
} catch {}

function ListEdge() {
	const fit = (px) => Math.round(Math.min(Math.max(px, 160), Math.min(640, innerWidth / 2)))
	const list = (el) => el.parentElement.querySelector('.thread-list')
	return html`
		<div
			class="list-edge"
			role="separator"
			aria-orientation="vertical"
			aria-label="Thread list width"
			tabindex="0"
			title="Drag to resize; double-click to reset"
			onPointerDown=${(event) => {
				const edge = event.currentTarget,
					left = list(edge).getBoundingClientRect().left
				edge.setPointerCapture(event.pointerId)
				const move = (pointer) => setWidth(fit(pointer.clientX - left))
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
			onDblClick=${() => setWidth(null)}
			onKeyDown=${(event) => {
				const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key]
				if (!step) return
				event.preventDefault()
				setWidth(fit(list(event.currentTarget).offsetWidth + step))
			}}
		></div>
	`
}
