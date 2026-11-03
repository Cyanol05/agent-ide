/** A bot's name, home, recipe and instructions. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, onSettled, refresh, Show, snapshot } from 'solid-js'
import { api, bots, colorOf, current, openThread, threads } from './server.js'
import { busiest, formatAgent } from './agent.js'
import { recipients } from './composer.js'
import { Dot } from './dot.js'
import { ThreadItem } from './thread-list.js'

export const BotItem = (props) => html`
	<li
		class=${() => ({ current: props.bot.home === current() })}
		title=${() => props.bot.instructions.split('\n')[0]}
		onClick=${() => openThread(props.bot.home)}
	>
		<${Dot}
			state=${() => busiest(threads.flatMap((t) => t.agents.filter((a) => a.name === props.bot.name)))}
		/>
		<span style=${() => colorOf(props.bot.name)}>${() => props.bot.name}</span>
	</li>
`

export function BotSettings(props) {
	let instructionsField, modelField
	const [instructions, setInstructions] = createSignal('')
	const [model, setModel] = createSignal('')
	createEffect(
		() => [props.bot.instructions, formatAgent(props.bot.to)],
		([instructions, model]) => {
			if (document.activeElement !== instructionsField) setInstructions(instructions)
			if (document.activeElement !== modelField) setModel(model)
		},
	)
	const [error, setError] = createSignal('')
	const elsewhere = () =>
		threads.filter(
			(t) =>
				t.id !== props.bot.home && !t.hidden && t.agents.some((a) => a.name === props.bot.name),
		)
	return html`
		<div class="bot">
			<h3>Instructions</h3>
			<textarea
				class="instructions"
				ref=${(el) => {
					instructionsField = el
				}}
				rows="8"
				aria-label="Bot instructions"
				placeholder="Who it is, in its words or yours"
				value=${() => instructions()}
				onInput=${(e) => setInstructions(e.currentTarget.value)}
				onChange=${() =>
					api('/api/bots', { name: props.bot.name, instructions: instructions() })
						.then(() => refresh(bots))
						.catch((e) => alert(e.message))}
			></textarea>
			<h3>Model</h3>
			<input
				class=${() => ['model', { bad: !!error() }]}
				aria-label="Bot model"
				ref=${(el) => {
					modelField = el
				}}
				spellcheck="false"
				title=${() => error() || 'The model it joins new threads with: model:thinking@runner'}
				value=${() => model()}
				onInput=${(e) => setModel(e.currentTarget.value)}
				onKeyDown=${(e) => {
					if (e.key === 'Enter') e.currentTarget.blur()
				}}
				onChange=${async () => {
					try {
						await api('/api/bots', { name: props.bot.name, to: model().trim() })
						setError('')
						refresh(bots)
					} catch (e) {
						setError(e.message)
					}
				}}
			/>
			<${Show} when=${() => elsewhere().length}>
				<h3 class="also">Also in</h3>
				<ul class="thread-family">
					<${For} each=${() => elsewhere()}>${(t) => html`<${ThreadItem} thread=${() => t} />`}<//>
				</ul>
			<//>
			<button
				type="button"
				class="forget"
				title="Every thread stays; agents of its name stop reading its instructions"
				onClick=${async () => {
					if (!confirm(`Forget ${props.bot.name}? Its instructions go; every thread stays.`)) return
					try {
						await api(`/api/bots/${encodeURIComponent(props.bot.name)}`, undefined, 'DELETE')
						refresh(bots)
					} catch (e) {
						alert(e.message)
					}
				}}
			>
				Forget this bot
			</button>
		</div>
	`
}

export function NewBot(props) {
	let input
	const [error, setError] = createSignal('')
	const [name, setName] = createSignal('')
	const [saving, setSaving] = createSignal(false)
	onSettled(() => input.focus())
	return html`
		<li>
			<input
				ref=${(el) => {
					input = el
				}}
				placeholder="a name"
				spellcheck="false"
				class=${() => ({ bad: !!error() })}
				title=${() => error() || 'How anyone asks it, in any thread'}
				value=${() => name()}
				onInput=${(e) => setName(e.currentTarget.value)}
				onBlur=${() => {
					if (!saving()) props.onDone()
				}}
				onKeyDown=${async (e) => {
					if (e.key === 'Escape') return props.onDone()
					if (e.key !== 'Enter' || saving()) return
					e.preventDefault()
					setSaving(true)
					try {
						const [pick] = snapshot(recipients())
						if (!pick) throw new Error('Pick a model first: a new bot starts on it')
						const { home } = await api('/api/bots', {
							name: name().trim(),
							to: { ...pick, name: undefined },
						})
						refresh(bots)
						openThread(home)
						props.onDone()
					} catch (error) {
						setError(error.message)
					} finally {
						setSaving(false)
					}
				}}
			/>
		</li>
	`
}
