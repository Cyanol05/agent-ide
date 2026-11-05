/** The client, server, threads and runners, with the routes between them. */
import html from '@solidjs/html'
import { createMemo, For } from 'solid-js'
import { connected, current, family, runners, threads, url } from './server.js'
import { agentKey, sameAgent } from './agent.js'
import { recipients } from './composer.js'
import { Dot } from './dot.js'
import { Runner } from './runner.js'
import { Thread } from './thread.js'
import { ThreadList } from './thread-list.js'
import { Wires } from './wires.js'

export function System() {
	const shown = createMemo(() => threads.filter((t) => family().includes(t.id)))
	const agents = createMemo(() =>
		shown().flatMap((t) => t.agents.map((a) => ({ ...a, thread: t.id }))),
	)
	const connections = createMemo(() => {
		const asking = recipients()
		const down = { fromSide: 'bottom', toSide: 'top', fromAt: 'to' }
		const row = (to) => `[data-agent="${CSS.escape(agentKey(to))}"]`
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
		const reached = new Set([...asking.map((p) => p.runner), ...agents().map((a) => a.to.runner)])
		for (const r of runners)
			if (!reached.has(r.name))
				edges.push({
					...down,
					from: '.server',
					to: `[data-runner="${CSS.escape(r.name)}"]`,
					toAt: 40,
					state: connected() && r.online ? '' : 'off',
				})
		for (const a of agents()) {
			if (a.thread === current() && asking.some((p) => sameAgent(p, a.to))) continue
			edges.push({
				...down,
				from: `[data-thread="${a.thread}"]`,
				to: row(a.to),
				toAt: -20,
				state: state(a.status),
			})
		}
		for (const to of asking)
			edges.push({
				...down,
				from: '.thread.current .pick',
				to: row(to),
				toAt: -20,
				state:
					state(agents().find((a) => a.thread === current() && sameAgent(a.to, to))?.status) ||
					'route',
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
						<${For} each=${() => family()}>${(id) => html`<${Thread} id=${() => id} />`}<//>
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
			onPointerDown=${(e) => {
				const edge = e.currentTarget,
					left = list(edge).getBoundingClientRect().left
				edge.setPointerCapture(e.pointerId)
				const move = (m) => setWidth(fit(m.clientX - left))
				const up = () => {
					edge.removeEventListener('pointermove', move)
					edge.removeEventListener('pointerup', up)
					document.body.classList.remove('resizing')
				}
				edge.addEventListener('pointermove', move)
				edge.addEventListener('pointerup', up)
				document.body.classList.add('resizing')
				e.preventDefault()
			}}
			onDblClick=${() => setWidth(null)}
			onKeyDown=${(e) => {
				const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key]
				if (!step) return
				e.preventDefault()
				setWidth(fit(list(e.currentTarget).offsetWidth + step))
			}}
		></div>
	`
}
