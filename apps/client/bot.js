/** A bot's name, home, recipe and instructions. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, onSettled, refresh, Show, snapshot } from 'solid-js'
import { api, bots, colorOf, current, openThread, threads } from './server.js'
import { busiest, formatAgent } from './agent.js'
import { openPicker, recipients } from './composer.js'
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
			state=${() => busiest(threads.flatMap((t) => t.agents.filter((a) => a.name === props.bot.name)))}
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
						.catch(report)}
			></textarea>
			<h3>Model</h3>
			<button
				type="button"
				class="model"
				title="The model it joins new threads with"
				onClick=${(e) => openPicker(e.currentTarget)}
			>
				${() => formatAgent(props.bot.to)}
			</button>
			<${Show} when=${() => elsewhere().length}>
				<h3 class="also">Also in</h3>
				<ul class="thread-family">
					<${For} each=${() => elsewhere()}>${(t) => html`<${ThreadItem} thread=${() => t} />`}<//>
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
					} catch (e) {
						report(e)
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
