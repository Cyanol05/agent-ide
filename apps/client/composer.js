// The composer: what you write, and whom it asks as one editable name. It moves into whichever thread is current;
// its model button opens the picker.
import { $, h, dotClass, placePopover } from './dom.js'
import { THINKING_LEVELS, agentLabel, formatAgent, sameAgent } from './agent.js'
import {
	ask,
	botAgent,
	bots,
	choose,
	colorOf,
	current,
	homeBot,
	pickOn,
	pickRunner,
	picks,
	picksTyped,
	recipients,
	resolveAgent,
	runnerSettings,
	runners,
	settingFor,
	threads,
	tune,
} from './state.js'

export const form = $('composer').content.cloneNode(true).querySelector('form')
export const pickButton = form.querySelector('.pick')
const recipientsField = form.querySelector('#to')
const picker = $('picker')
picker.append(recipientsField)

form.onsubmit = async (e) => {
	e.preventDefault()
	const input = form.querySelector('input'),
		body = input.value
	input.value = ''
	await ask(body).catch((error) => {
		input.value = body
		alert(error.message)
	})
}
recipientsField.oninput = () => {
	const next = recipientsField.value
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map(resolveAgent)
	for (const { runner, name, ...set } of next) if (!name) runnerSettings[runner] = set
	choose(next, true)
}
// Enter in the name line keeps the name; it doesn't send.
recipientsField.onkeydown = (e) => {
	if (e.key === 'Enter') e.preventDefault()
}

pickButton.onclick = () => picker.togglePopover()
export const openPicker = () => picker.showPopover()
picker.addEventListener('toggle', (e) => {
	pickButton.ariaExpanded = String(e.newState === 'open')
	if (e.newState === 'open') {
		picker.querySelector('ul').replaceChildren(...Picker())
		placePopover(picker, pickButton)
	}
})

// The composer names whom it asks. A bot's home asks the bot.
export function drawComposer() {
	const asking = recipients()
	const agents = threads.find((t) => t.id === current)?.agents ?? []
	const busy = asking.some((p) => agents.some((a) => sameAgent(a.to, p) && a.status === 'working'))
	if (!picksTyped) recipientsField.value = picks.map(formatAgent).join(', ')
	pickButton.children[1].textContent = asking.length
		? asking.map(agentLabel).join(' + ')
		: 'Pick a model'
	// Whom it asks is the whole invite: asked once, an agent is in the thread.
	form.querySelector('input').placeholder = asking.length
		? `Ask ${asking.map(agentLabel).join(' and ')}`
		: 'Pick whom to ask, below'
	pickButton.firstChild.className = asking.length ? dotClass(busy ? 'working' : 'on') : dotClass()
	pickButton.disabled = Boolean(homeBot(current))
	pickButton.title = homeBot(current) ? 'Its home asks the bot' : recipientsField.value
	if (picker.matches(':popover-open') && !picker.contains(document.activeElement))
		picker.querySelector('ul').replaceChildren(...Picker())
}

// The model picker: whom the next message asks, chosen where you write. One row per runner that's online, then bots.
export function Picker() {
	const online = runners.filter((r) => r.online)
	const rows = online.map((r) => PickerRunner(r, online.length > 1))
	return [
		...(rows.length ? rows : [h('li', { className: 'mute', textContent: 'No runner is online.' })]),
		...(bots.length ? [h('li', {}, h('h4', { textContent: 'Bots' })), ...bots.map(PickerBot)] : []),
	]
}
function PickerRunner(r, several) {
	const set = settingFor(r),
		on = Boolean(pickOn(r))
	const models = [...new Set([set.model, r.model, ...(r.offers ?? [])].filter(Boolean))]
	// A model is a row: click to ask it here, shift-click to ask it too. Thinking is a row of steps; the lit one again goes back to default.
	const model = (o) =>
		h(
			'button',
			{
				type: 'button',
				className: `model${on && o === set.model ? ' on' : ''}`,
				onclick: (e) => {
					tune(r, { model: o })
					if (!on || !(e.shiftKey || picks.length > 1)) pickRunner(r, e.shiftKey)
					if (!e.shiftKey) picker.hidePopover()
				},
			},
			h('span', { textContent: o.split('/').pop() }),
			h('small', { textContent: o.includes('/') ? o.split('/')[0] : '' }),
		)
	const step = (x) =>
		h('button', {
			type: 'button',
			textContent: { minimal: 'min', medium: 'med' }[x] ?? x,
			title: x,
			ariaPressed: String(set.thinkingLevel === x),
			onclick: () => tune(r, { thinkingLevel: set.thinkingLevel === x ? undefined : x }),
		})
	// The folders it serves, when there's a choice: its first is '', the rest relative to it when inside.
	const folders = (r.folders ?? []).map((f) => {
		const rel = f === r.dir ? '' : f.startsWith(`${r.dir}/`) ? f.slice(r.dir.length + 1) : f
		return new Option(rel || f, rel)
	})
	const where =
		folders.length > 1 &&
		h('select', { onchange: () => tune(r, { dir: where.value || undefined }) }, ...folders)
	if (where) where.value = set.dir ?? ''
	return h(
		'li',
		{ className: on ? 'on' : '' },
		h(
			'div',
			{ className: 'who' },
			h('span', { className: dotClass(r.busy ? 'working' : 'on') }),
			h('b', { textContent: r.name }),
			h('small', {
				textContent: r.busy ? `busy in ${r.busy} thread${r.busy > 1 ? 's' : ''}` : r.dir,
				title: r.dir,
			}),
			several &&
				h('button', {
					type: 'button',
					className: 'also',
					textContent: on ? 'asked' : 'ask too',
					ariaPressed: String(on),
					title: 'Ask it too',
					onclick: () => pickRunner(r, true),
				}),
		),
		h('div', { className: 'models' }, ...models.map(model)),
		h('h4', { textContent: 'Thinking' }),
		h('div', { className: 'steps' }, ...THINKING_LEVELS.map(step)),
		where && h('h4', { textContent: 'Folder' }),
		where,
	)
}
// A bot: click to ask it here, shift-click to ask it too.
function PickerBot(b) {
	const on = picks.some((p) => p.name === b.name)
	return h(
		'li',
		{ className: on ? 'on' : '' },
		h(
			'button',
			{
				type: 'button',
				className: `model${on ? ' on' : ''}`,
				onclick: (e) => {
					choose(
						e.shiftKey
							? on
								? picks.filter((p) => p.name !== b.name)
								: [...picks, botAgent(b)]
							: [botAgent(b)],
					)
					if (!e.shiftKey) picker.hidePopover()
				},
			},
			h('span', { textContent: b.name, style: colorOf(b.name) }),
			h('small', { textContent: formatAgent(b.to) }),
		),
	)
}
