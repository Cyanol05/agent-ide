/** A bot's name, home, recipe and instructions. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, onSettled, refresh, Show, snapshot } from 'solid-js'
import { api, bots, colorOf, current, openThread, threads } from './server.js'
import { formatAgent } from './agent.js'
import { agent, openPicker } from './composer.js'
import { Dot } from './dot.js'
import { ThreadItem } from './thread-list.js'
import { report } from './notice.js'
import { Sure } from './sure.js'

export const BotItem = (props) => html`
	<li
		class=${() => ({ current: props.bot.home === current() })}
		title=${() => props.bot.instructions.split('\n')[0]}
		onClick=${() => openThread(props.bot.home)}
	>
		<${Dot}
			state=${() => props.bot.status}
		/>
		<span style=${() => colorOf(props.bot.name)}>${() => props.bot.name}</span>
	</li>
`

export function BotSettings(props) {
	let instructionsField
	const [instructions, setInstructions] = createSignal('')
	createEffect(
		() => props.bot.instructions,
		(instructions) => {
			if (document.activeElement !== instructionsField) setInstructions(instructions)
		},
	)
	const elsewhere = () =>
		threads.filter(
			(thread) =>
				thread.id !== props.bot.home && !thread.hidden && thread.agents.some((agent) => agent.name === props.bot.name),
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
				onInput=${(event) => setInstructions(event.currentTarget.value)}
				onChange=${() =>
					api('/api/bots', { name: props.bot.name, instructions: instructions() })
						.then(() => refresh(bots))
						.catch(report)}
			></textarea>
			<h3>Model</h3>
			<button
				type="button"
				class="model"
				title="The model it joins new threads with"
				onClick=${(event) => openPicker(event.currentTarget)}
			>
				${() => formatAgent(props.bot.to)}
			</button>
			<${Show} when=${() => elsewhere().length}>
				<h3 class="also">Also in</h3>
				<ul class="thread-family">
					<${For} each=${() => elsewhere()}>${(thread) => html`<${ThreadItem} thread=${() => thread} />`}<//>
				</ul>
			<//>
			<${Sure}
				class="forget"
				title="Every thread stays; agents of its name stop reading its instructions"
				ask=${() => `Forget ${props.bot.name}?`}
				why="Its instructions go; every thread stays."
				onConfirm=${async (_e) => {
					try {
						await api(`/api/bots/${encodeURIComponent(props.bot.name)}`, undefined, 'DELETE')
						refresh(bots)
					} catch (failure) {
						report(failure)
					}
				}}
				>Forget this bot<//
			>
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
				onInput=${(event) => setName(event.currentTarget.value)}
				onBlur=${() => {
					if (!saving()) props.onDone()
				}}
				onKeyDown=${async (event) => {
					if (event.key === 'Escape') return props.onDone()
					if (event.key !== 'Enter' || saving()) return
					event.preventDefault()
					setSaving(true)
					try {
						const pick = snapshot(agent())
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
