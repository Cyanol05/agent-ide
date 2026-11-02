/** Runners */
import { $, h, dotClass, placePopover } from './dom.js'
import { THINKING_LEVELS, agentKey, busiest, lastToolCall } from './agent.js'
import { doing, pickOn, pickRunner, picks, runners, settingFor, threads, tune } from './state.js'

/** One runner */
export function Runner(r, asked) {
	const set = settingFor(r)
	const on = Boolean(pickOn(r)),
		routed = picks.some((p) => p.runner === r.name)
	const here = asked.filter((a) => a.to.runner === r.name)
	const row = (to, ...children) => {
		const list = here.filter((a) => agentKey(a.to) === agentKey(to)),
			state = busiest(list)
		const call = list.map((a) => lastToolCall(doing.get(`${a.thread} ${a.name}`))).find(Boolean)
		const li = h(
			'li',
			{},
			...children,
			list.length && h('span', { className: dotClass(state), title: state || 'idle' }),
			call && h('span', { className: 'hands', textContent: call, title: call }),
		)
		li.dataset.agent = agentKey(to)
		return li
	}
	const stop = (e) => e.stopPropagation()
	const models = [...new Set([set.model, r.model, ...(r.offers ?? [])].filter(Boolean))]
	const swap = h(
		'select',
		{
			className: 'swap',
			title: 'model',
			onclick: stop,
			onchange: () => tune(r, { model: swap.value }),
		},
		...models.map((o) => new Option(o, o)),
	)
	swap.value = set.model ?? ''
	/** How hard it thinks: a slider from the runner's default up to max */
	const knob = h('input', {
		type: 'range',
		min: 0,
		max: THINKING_LEVELS.length,
		value: THINKING_LEVELS.indexOf(set.thinkingLevel) + 1,
		title: set.thinkingLevel || 'default thinking',
		onclick: stop,
	})
	knob.onchange = () =>
		tune(r, { thinkingLevel: knob.value > 0 ? THINKING_LEVELS[knob.value - 1] : undefined })
	const own = { runner: r.name, model: set.model }
	const others = [...new Map(here.map((a) => [agentKey(a.to), a.to])).values()].filter(
		(to) => agentKey(to) !== agentKey(own),
	)
	return h(
		'div',
		{
			className: `node card${r.online ? '' : ' off'}${routed ? ' routed' : ''}`,
			id: `runner-${r.name}`,
			title: on ? 'Shift-click to stop asking it' : 'Click to ask it; shift-click to ask it too',
			onclick: (e) => pickRunner(r, e.shiftKey || e.metaKey || e.ctrlKey),
		},
		h('b', {}, h('span', { className: dotClass(r.online ? busiest(here) || 'on' : '') }), r.name),
		h('small', { textContent: r.dir }),
		!models.length && h('small', { textContent: 'No models here yet: run pi there and /login.' }),
		h(
			'ul',
			{ className: 'models' },
			models.length && row(own, swap, knob),
			...others.map((to) =>
				row(
					to,
					h('span', { className: 'name', textContent: to.name ?? to.model, title: to.model }),
				),
			),
		),
	)
}

/** The runner list's button: a dot per runner, and how many are online */
export function RunnerCount() {
	const online = runners.filter((r) => r.online).length
	return [
		...runners.map((r) => h('span', { className: dotClass(r.online ? 'on' : '') })),
		h('span', { textContent: `${online} runner${online === 1 ? '' : 's'} online` }),
	]
}
/** The runners connected to this server: who's there, where, and what they're doing */
export function RunnerList() {
	const busy = (r) =>
		threads.flatMap((t) =>
			t.agents
				.filter((a) => a.to.runner === r.name && a.status === 'working')
				.map((a) => ({ t, a })),
		)
	return runners.map((r) => {
		const work = busy(r)
		const call = work.map(({ t, a }) => lastToolCall(doing.get(`${t.id} ${a.name}`))).find(Boolean)
		return h(
			'li',
			{},
			h('span', { className: dotClass(r.online ? (work.length ? 'working' : 'on') : '') }),
			h(
				'div',
				{},
				h('b', { textContent: r.name }),
				h('small', { textContent: r.dir }),
				(!r.online || work.length > 0) &&
					h('small', {
						className: r.online ? 'doing' : '',
						textContent: !r.online
							? 'offline'
							: call || `working in ${work.map(({ t }) => t.title || 'untitled').join(', ')}`,
					}),
			),
		)
	})
}
/** The runner list, and under it how to add a runner: the line the page shows in the story */
const list = $('runner-list')
export function drawRunnerList() {
	if (!list.matches(':popover-open')) return
	list.querySelector('ul').replaceChildren(...RunnerList())
	list.querySelector('pre').textContent = $('lend').textContent
}
$('runner-count').onclick = () => list.togglePopover()
list.addEventListener('toggle', (e) => {
	if (e.newState === 'open') {
		drawRunnerList()
		placePopover(list, $('runner-count'))
	}
})
