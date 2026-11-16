/** Model, thinking and folder controls, without owning a popup or changing a thread themselves. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { runners } from './server.js'
import { modelsOf, THINKING_LEVELS, thinkingWord } from './agent.js'
import { Dot } from './dot.js'
import { Icon } from './icons.js'
import { ConnectRunner } from './runner.js'

/** Every word typed is somewhere in the text. */
export const matches = (query, text) =>
	query
		.toLowerCase()
		.split(/\s+/)
		.every((word) => text.toLowerCase().includes(word))

/**
 * A search on top, each runner's models in one list under it, and the thinking and folder of the runner asked pinned at the bottom.
 * Typing filters the list; the arrows walk it and Enter picks, or hands what was typed to `onType` when nothing matches or it reads as an address.
 * getTo(runner) supplies each runner's choice; the caller decides when a choice is applied or closes the view. `more(query)` adds rows after the models.
 */
export function ModelPicker(props) {
	let list
	const [query, setQuery] = createSignal('')
	const [highlighted, setHighlighted] = createSignal(-1)
	const online = () => runners.filter((runner) => runner.online)
	const footRunner = () =>
		online().find((runner) => runner.name === props.selectedRunner) ?? online()[0]
	const options = () => [...(list?.querySelectorAll('button.model') ?? [])]
	// The highlight follows the typing to the first match, and the keys after that
	createEffect(
		() => [query(), highlighted()],
		([typed, index]) => {
			const all = options()
			const at = index < 0 && typed.trim() ? 0 : index
			all.forEach((option, i) => option.toggleAttribute('data-highlighted', i === at))
			all[at]?.scrollIntoView({ block: 'nearest' })
		},
	)
	const reset = () => {
		setQuery('')
		setHighlighted(-1)
	}
	const onKeyDown = (event) => {
		if (event.isComposing) return
		const all = options()
		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
		if (step && all.length) {
			event.preventDefault()
			const from = highlighted() < 0 ? (query().trim() ? 0 : step > 0 ? -1 : 0) : highlighted()
			return setHighlighted((from + step + all.length) % all.length)
		}
		if (event.key !== 'Enter') return
		event.preventDefault()
		const text = event.currentTarget.value.trim()
		const option = all[highlighted() < 0 ? 0 : highlighted()]
		if (props.onType && text && (/[@,]/.test(text) || !option)) props.onType(text)
		else if (option && (text || highlighted() >= 0)) option.click()
		else return
		reset()
		event.currentTarget.value = ''
	}
	return html`
		<div class="model-controls">
			<div class="search">
				<input
					type="search"
					aria-label="Search models"
					placeholder=${() =>
						props.onType ? 'Search, or type model:thinking@runner' : 'Search models'}
					autocomplete="off"
					autocapitalize="none"
					autocorrect="off"
					spellcheck="false"
					autofocus=${!matchMedia('(pointer: coarse)').matches}
					ref=${(el) =>
						queueMicrotask(() =>
							el.closest('[popover]')?.addEventListener('toggle', (event) => {
								if (event.newState !== 'closed') return
								reset()
								el.value = ''
							}),
						)}
					onInput=${(event) => {
						setQuery(event.currentTarget.value)
						setHighlighted(-1)
					}}
					onKeyDown=${onKeyDown}
				/>
				${() => props.close}
			</div>
			<ul class="model-list" ref=${(el) => (list = el)}>
				<${Show} when=${() => !query().trim()}>${() => props.first}<//>
				<${For}
					each=${online}
					fallback=${html`
						<li class="mute no-runner">
							No runner is online.
							<${ConnectRunner} />
						</li>
					`}
				>
					${(runner) => PickerRunner(runner, props, query)}
				<//>
				${() => props.more?.(query().trim())}
			</ul>
			<${Show} when=${footRunner}> ${() => PickerFoot(footRunner(), props)} <//>
		</div>
	`
}

/** A runner's name, then its models that match what was typed; nothing when none do. */
function PickerRunner(runner, props, query) {
	const to = () => props.getTo(runner)
	const selected = () => props.selectedRunner === runner.name
	const models = () =>
		modelsOf(runner, to()).filter((model) => matches(query().trim(), `${model} ${runner.name}`))
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
