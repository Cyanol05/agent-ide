/** Model, thinking and folder controls, without owning a popup or changing a thread themselves. */
import html from '@solidjs/html'
import { For, Show } from 'solid-js'
import { runners } from './server.js'
import { THINKING_LEVELS } from './agent.js'
import { Dot } from './dot.js'
import { ConnectRunner } from './runner.js'

/** getTo(runner) supplies each runner's choice; the caller decides when a choice is applied or closes the view. */
export function ModelPicker(props) {
	return html`
		<div class="model-controls">
			<ul>
				<${For}
					each=${() => runners.filter((runner) => runner.online)}
					fallback=${html`
						<li class="mute no-runner">
							No runner is online.
							<${ConnectRunner} />
						</li>
					`}
				>
					${(runner) => PickerRunner(runner, props)}
				<//>
				${() => props.children}
			</ul>
		</div>
	`
}

function PickerRunner(runner, props) {
	const to = () => props.getTo(runner)
	const selected = () => props.selectedRunner === runner.name
	const models = () => [
		...new Set([to().model, runner.model, ...(runner.offers ?? [])].filter(Boolean)),
	]
	const folderValue = (folder) =>
		folder === runner.dir
			? ''
			: folder.startsWith(`${runner.dir}/`)
				? folder.slice(runner.dir.length + 1)
				: folder
	return html`
		<li class=${() => ({ on: selected() })}>
			<div class="who">
				<${Dot} state=${() => (runner.status === 'idle' ? 'on' : runner.status)} /><b
					>${() => runner.name}</b
				>
				<small title=${() => runner.dir}
					>${() =>
						runner.busy
							? `busy in ${runner.busy} thread${runner.busy > 1 ? 's' : ''}`
							: runner.dir}</small
				>
			</div>
			<div class="models">
				<${For} each=${() => models()}
					>${(model) => html`
						<button
							type="button"
							class=${() => ['model', { on: selected() && to().model === model }]}
							aria-pressed=${() => String(selected() && to().model === model)}
							onClick=${() => props.onChoose({ ...to(), model })}
						>
							<span>${() => model.split('/').pop()}</span
							><small>${() => (model.includes('/') ? model.split('/')[0] : '')}</small>
						</button>
					`}<//
				>
			</div>
			<h3>Thinking</h3>
			<div class="steps">
				<${For} each=${() => THINKING_LEVELS}
					>${(level) => html`
						<button
							type="button"
							title=${() => level}
							aria-pressed=${() => String(to().thinkingLevel === level)}
							onClick=${() =>
								props.onConfigure({
									...to(),
									thinkingLevel: to().thinkingLevel === level ? undefined : level,
								})}
						>
							${() => ({ minimal: 'min', medium: 'med' })[level] ?? level}
						</button>
					`}<//
				>
			</div>
			<${Show} when=${() => props.folders && runner.folders?.length > 1}>
				<h3>Folder</h3>
				<select
					aria-label="Folder"
					value=${() => to().dir ?? ''}
					onChange=${(event) => props.onConfigure({ ...to(), dir: event.currentTarget.value || undefined })}
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
		</li>
	`
}
