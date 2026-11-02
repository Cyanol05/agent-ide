// Bots, with the bots module: a row in the list, its settings at its home, and naming a new one.
import { h, dotClass } from './dom.js'
import { busiest, formatAgent } from './agent.js'
import {
	changed,
	colorOf,
	createBot,
	current,
	forgetBot,
	openThread,
	recipients,
	refresh,
	saveBot,
	setBotModel,
	threads,
} from './state.js'
import { ThreadItem } from './thread.js'

// A bot as a row: lit while an agent of its name works anywhere, its name in its color; it opens its home.
export const BotItem = (b) =>
	h(
		'li',
		{
			className: b.home === current ? 'current' : '',
			title: b.instructions.split('\n')[0],
			onclick: () => openThread(b.home),
		},
		h('span', { className: dotClass(busiest(threads.flatMap((t) => t.agents.filter((a) => a.name === b.name)))) }),
		h('span', { textContent: b.name, style: colorOf(b.name) }),
	)

// At a bot's home, the details are the bot's: its instructions, the model it joins threads with, where else it is.
// One node, drawn again for whichever bot; hidden anywhere else.
let shown = null
const instructions = h('textarea', {
	className: 'instructions',
	rows: 8,
	placeholder: 'Who it is, in its words or yours',
	onchange: (e) => saveBot({ name: shown.name, instructions: e.target.value }),
})
// As the composer's name line and `pi --model` take it.
const model = h('input', {
	className: 'model',
	spellcheck: false,
	title: 'The model it joins new threads with: model:thinking@runner',
	onkeydown: (e) => {
		if (e.key === 'Enter') e.target.blur()
	},
	onchange: (e) =>
		setBotModel(shown.name, e.target.value.trim())
			.then(
				() => e.target.classList.remove('bad'),
				(error) => {
					e.target.classList.add('bad')
					e.target.title = error.message
				},
			)
			.then(refresh),
})
const alsoIn = h('h3', { className: 'also', textContent: 'Also in' })
const elsewhereList = h('ul', { className: 'thread-family' })
const settings = h(
	'div',
	{ className: 'bot', hidden: true },
	h('h3', { textContent: 'Instructions' }),
	instructions,
	h('h3', { textContent: 'Model' }),
	model,
	alsoIn,
	elsewhereList,
	h('button', {
		type: 'button',
		className: 'forget',
		textContent: 'Forget this bot',
		title: 'Every thread stays; agents of its name stop reading its instructions',
		onclick: () => {
			if (confirm(`Forget ${shown.name}? Its instructions go; every thread stays.`)) forgetBot(shown.name)
		},
	}),
)
export function BotSettings(bot) {
	shown = bot
	settings.hidden = !bot
	if (!bot) return settings
	for (const [field, value] of [
		[instructions, bot.instructions],
		[model, formatAgent(bot.to)],
	])
		if (document.activeElement !== field) field.value = value
	const elsewhere = threads.filter(
		(t) => t.id !== bot.home && !t.hidden && t.agents.some((a) => a.name === bot.name),
	)
	alsoIn.hidden = !elsewhere.length
	elsewhereList.replaceChildren(...elsewhere.map((t) => ThreadItem(t)))
	return settings
}

// A new bot: its name first, which is how anyone asks it; it starts on the model the composer would ask.
export function NewBot() {
	const [pick] = recipients()
	const field = h('input', {
		placeholder: 'a name',
		spellcheck: false,
		title: 'How anyone asks it, in any thread',
		onkeydown: async (e) => {
			if (e.key === 'Escape') return field.blur()
			if (e.key !== 'Enter') return
			try {
				if (!pick) throw new Error('Pick a model first: a new bot starts on it')
				await createBot(field.value.trim(), { ...pick, name: undefined })
				field.blur()
			} catch (error) {
				field.classList.add('bad')
				field.title = error.message
			}
		},
		onblur: () => setTimeout(changed),
	})
	return h('li', {}, field)
}
