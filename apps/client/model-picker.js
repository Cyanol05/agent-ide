/** Model, thinking and folder controls, without owning a popup or changing a thread themselves. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js'
import { runners } from './server.js'
import { modelsOf, THINKING_LEVELS, thinkingWord } from './agent.js'
import { Dot } from './dot.js'
import { Icon } from './icons.js'
import { ConnectRunner } from './runner.js'

/** Every word of the search is somewhere in the text. */
export const matches = (search, text) =>
	search
		.toLowerCase()
		.split(/\s+/)
		.every((word) => text.toLowerCase().includes(word))

/**
 * A search on top, each runner's models in one list under it, and the thinking and folder of the runner asked pinned at the bottom.
 * Typing filters the list; the arrows walk it and Enter picks the highlighted row. A line that reads as recipients (an `@` or a comma), or matches nothing, goes to `onRecipients` instead.
 * getTo(runner) supplies each runner's choice; the caller decides when a choice is applied or closes the view.
 * `before` is rows above the models while nothing is typed; `after(search)` rows under them, filtered by the caller.
 */
export function ModelPicker(props) {
	let input, list
	const [typed, setTyped] = createSignal('')
	const search = () => typed().trim()
	// -1 is none chosen by the keys: then a search highlights its first match, and no search nothing
	const [keyed, setKeyed] = createSignal(-1)
	const highlighted = () => (keyed() < 0 && search() ? 0 : keyed())
	const online = () => runners.filter((runner) => runner.online)
	const askedRunner = () =>
		online().find((runner) => runner.name === props.selectedRunner) ?? online()[0]
	const options = () => [...(list?.querySelectorAll('button.model') ?? [])]
	const clear = () => {
		input.value = ''
		setTyped('')
		setKeyed(-1)
	}
	createEffect(highlighted, (index) => {
		options().forEach((option, at) => option.toggleAttribute('data-highlighted', at === index))
		options()[index]?.scrollIntoView({ block: 'nearest' })
	})
	// Closing the popover it sits in starts the next opening on an empty search
	onSettled(() => {
		const popover = input.closest('[popover]')
		const closed = (event) => event.newState === 'closed' && clear()
		popover?.addEventListener('toggle', closed)
		return () => popover?.removeEventListener('toggle', closed)
	})
	const walk = (step) => {
		const count = options().length
		if (!count) return
		if (highlighted() < 0) return setKeyed(step > 0 ? 0 : count - 1)
		setKeyed((highlighted() + step + count) % count)
	}
	const enter = () => {
		const option = options()[highlighted()]
		if (props.onRecipients && search() && (/[@,]/.test(search()) || !option))
			props.onRecipients(search())
		else if (option) option.click()
		else return
		clear()
	}
	return html`
		<div class="model-controls">
			<div class="search">
				<input
					type="search"
					aria-label="Search models"
					placeholder=${() =>
						props.onRecipients ? 'Search, or type model:thinking@runner' : 'Search models'}
					autocomplete="off"
					autocapitalize="none"
					autocorrect="off"
					spellcheck="false"
					autofocus=${!matchMedia('(pointer: coarse)').matches}
					ref=${(el) => (input = el)}
					onInput=${(event) => {
						setTyped(event.currentTarget.value)
						setKeyed(-1)
					}}
					onKeyDown=${(event) => {
						if (event.isComposing) return
						const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
						if (step) walk(step)
						else if (event.key === 'Enter') enter()
						else return
						event.preventDefault()
					}}
				/>
				${() => props.close}
			</div>
			<ul class="model-list" ref=${(el) => (list = el)}>
				<${Show} when=${() => !search()}>${() => props.before}<//>
				<${For}
					each=${online}
					fallback=${html`
						<li class="mute no-runner">
							No runner is online.
							<${ConnectRunner} />
						</li>
					`}
				>
					${(runner) => PickerRunner(runner, props, search)}
				<//>
				${() => props.after?.(search())}
			</ul>
			<${Show} when=${askedRunner}>${() => PickerFoot(askedRunner(), props)}<//>
		</div>
	`
}

/** A runner's name, then its models that match what was typed; nothing when none do. */
function PickerRunner(runner, props, search) {
	const to = () => props.getTo(runner)
	const selected = () => props.selectedRunner === runner.name
	const models = () =>
		modelsOf(runner, to()).filter((model) => matches(search(), `${model} ${runner.name}`))
	return html`
		<${Show} when=${() => models().length}>
			<li class=${() => ({ on: selected() })}>
				<div class="who">
					<${Dot} state=${() => (runner.status === 'idle' ? 'on' : runner.status)} /><b
						>${() => runner.name}</b
					>
				</div>
				<div class="models">
					<${For} each=${() => models()}
						>${(model) => html`
							<button
								type="button"
								class="ghost model"
								aria-pressed=${() => String(selected() && to().model === model)}
								onClick=${() => props.onChoose({ ...to(), model })}
							>
								<span>${() => model.split('/').pop()}</span
								><small>${() => (model.includes('/') ? model.split('/')[0] : '')}</small
								><${Show} when=${() => selected() && to().model === model}
									><${Icon} name="check"
								/><//>
							</button>
						`}<//
					>
				</div>
			</li>
		<//>
	`
}

/** How hard the asked runner's model thinks, and in which folder, under the list however long it gets. */
function PickerFoot(runner, props) {
	const to = () => props.getTo(runner)
	const folderValue = (folder) =>
		folder === runner.dir
			? ''
			: folder.startsWith(`${runner.dir}/`)
				? folder.slice(runner.dir.length + 1)
				: folder
	return html`
		<div class="foot">
			<h3>Thinking</h3>
			<div class="thinking">
				<${For} each=${() => THINKING_LEVELS}
					>${(level) => html`
						<button
							type="button"
							class="ghost small"
							title=${() => level}
							aria-pressed=${() => String(to().thinkingLevel === level)}
							onClick=${() =>
								props.onConfigure({
									...to(),
									thinkingLevel: to().thinkingLevel === level ? undefined : level,
								})}
						>
							${() => thinkingWord(level)}
						</button>
					`}<//
				>
			</div>
			<${Show} when=${() => props.folders && runner.folders?.length > 1}>
				<h3>Folder</h3>
				<select
					aria-label="Folder"
					value=${() => to().dir ?? ''}
					onChange=${(event) =>
						props.onConfigure({ ...to(), dir: event.currentTarget.value || undefined })}
				>
					<${For} each=${() => runner.folders}
						>${(folder) => html`
							<option value=${() => folderValue(folder)}>
								${() => folderValue(folder) || folder}
							</option>
						`}<//
					>
				</select>
			<//>
		</div>
	`
}
