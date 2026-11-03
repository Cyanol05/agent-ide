/** The draft and recipients stay with the composer as you move between threads. */
import html from '@solidjs/html'
import { createEffect, createRoot, createStore, For, latest, Show, snapshot } from 'solid-js'
import {
	api,
	bots,
	botAgent,
	colorOf,
	createThread,
	current,
	homeBot,
	openThread,
	runners,
	threads,
} from './server.js'
import { agentLabel, formatAgent, parseAgent, sameAgent, THINKING_LEVELS } from './agent.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'

const [compose, setCompose] = createRoot(() =>
	createStore({
		draft: '',
		sending: false,
		to: null,
		typed: null,
		settings: {},
	}),
)
let draftVersion = 0
export const choiceFor = (r) =>
	compose.to?.find((p) => p.runner === r.name && !p.name) ??
	compose.settings[r.name] ?? {
		runner: r.name,
		model: r.model,
		thinkingLevel: 'low',
	}
export const recipients = () => {
	const bot = homeBot(current())
	if (bot) return [botAgent(bot)]
	const home = runners.find((r) => r.online) ?? runners[0]
	return compose.to ?? (home?.model ? [choiceFor(home)] : [])
}
export const selectRecipients = (to) =>
	setCompose((s) => {
		s.to = to
		s.typed = null
	})
/** Choosing replaces the recipients; shift-click adds or removes one runner. */
export function choose(to, also = false) {
	const previous = recipients()
	const selected = previous.find((p) => p.runner === to.runner && p.name === to.name)
	let next = [to]
	if (also) {
		next = previous
		if (!selected) next = [...previous, to]
		else if (previous.length > 1) next = previous.filter((p) => p !== selected)
	}
	setCompose((s) => {
		s.to = next
		s.typed = null
		if (!to.name) s.settings[to.runner] = to
	})
}
/** Editing a runner's settings also changes its recipient, if it is selected. */
export function configure(to) {
	const previous = recipients()
	const selected = previous.find((p) => p.runner === to.runner && !p.name)
	setCompose((s) => {
		s.settings[to.runner] = to
		if (selected) {
			s.to = previous.map((p) => (p === selected ? to : p))
			s.typed = null
		}
	})
}

export function Composer(props) {
	let input, picker, button
	const active = () => current() === props.thread
	const agents = () => threads.find((t) => t.id === current())?.agents ?? []
	const busy = () =>
		agents().some((a) => a.status === 'working' && recipients().some((p) => sameAgent(a.to, p)))
	createEffect(active, (on) => {
		if (on) input.focus()
	})
	const submit = async (e) => {
		e.preventDefault()
		if (compose.sending || !recipients().length || !compose.draft.trim()) return
		const body = compose.draft,
			to = snapshot(recipients()),
			version = draftVersion
		let id = current()
		setCompose((s) => {
			s.sending = true
			s.draft = ''
		})
		try {
			id ??= await createThread(body.slice(0, 60))
			await api(`/api/threads/${id}/entries`, { body, to })
		} catch (error) {
			setCompose((s) => {
				if (latest(current) === id && draftVersion === version && !s.draft) s.draft = body
			})
			alert(error.message)
		} finally {
			setCompose((s) => {
				s.sending = false
			})
		}
	}
	const typeRecipients = (e) => {
		const text = e.currentTarget.value
		const next = text
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => {
				const bot = bots.find((b) => b.name === s)
				return agents().find((a) => a.name === s)?.to ?? (bot ? botAgent(bot) : parseAgent(s))
			})
		setCompose((s) => {
			s.to = next
			s.typed = text
			for (const to of next) if (!to.name) s.settings[to.runner] = to
		})
	}
	return html`
		<form class=${() => ({ compose: active(), elsewhere: !active() })} onSubmit=${submit}>
			<div class="box">
				<input
					ref=${(el) => (input = el)}
					autocomplete="off"
					required
					enterkeyhint="send"
					aria-label="Message"
					placeholder=${() =>
						!active()
							? 'Write here'
							: recipients().length
								? `Ask ${recipients().map(agentLabel).join(' and ')}`
								: 'Pick whom to ask, below'}
					value=${() => (active() ? compose.draft : '')}
					onFocus=${() => {
						if (!active()) openThread(props.thread)
					}}
					onInput=${(e) => {
						draftVersion++
						const to = !compose.to && !homeBot(current()) ? snapshot(recipients()) : null
						setCompose((s) => {
							s.draft = e.currentTarget.value
							if (to?.length) s.to = to
						})
					}}
				/>
				<${Show} when=${() => active()}>
					<button
						class="icon send"
						title="Send"
						aria-label="Send"
						disabled=${() => compose.sending || !recipients().length}
					>
						↵
					</button>
				<//>
			</div>
			<div class="bar">
				<button
					type="button"
					class="icon add"
					disabled
					title="Attach (not yet)"
					aria-label="Attach"
				>
					+
				</button>
				<button type="button" class="icon mic" disabled title="Voice (not yet)" aria-label="Voice">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					>
						<rect x="9" y="3" width="6" height="11" rx="3" />
						<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
					</svg>
				</button>
				<${Show}
					when=${() =>
						active() &&
						threads.some((t) => t.id === current() && ['working', 'blocked'].includes(t.status))}
				>
					<button
						type="button"
						class="icon"
						aria-label="Stop"
						title="Stop this thread"
						onClick=${() => api(`/api/threads/${current()}/stop`, {}).catch((e) => alert(e.message))}
					>
						Stop
					</button>
				<//>
				<button
					type="button"
					class="pick"
					aria-label="Model"
					ref=${(el) => (button = el)}
					aria-expanded="false"
					disabled=${() => !!homeBot(current())}
					title=${() =>
						homeBot(current()) ? 'Its home asks the bot' : recipients().map(formatAgent).join(', ')}
					onClick=${() => {
						openThread(props.thread)
						picker.togglePopover()
					}}
				>
					<${Dot} state=${() => (recipients().length ? (busy() ? 'working' : 'on') : '')} />
					<span>${() => recipients().map(agentLabel).join(' + ') || 'Pick a model'}</span>
				</button>
			</div>
			<div
				class="model-picker"
				popover
				ref=${(el) => (picker = el)}
				onToggle=${(e) => {
					button.setAttribute('aria-expanded', String(e.newState === 'open'))
					if (e.newState === 'open') placePopover(picker, button)
				}}
			>
				<ul>
					<${For}
						each=${() => runners.filter((r) => r.online)}
						fallback=${html`<li class="mute">No runner is online.</li>`}
					>
						${(r) => PickerRunner(r, () => picker.hidePopover())}
					<//>
					<${Show} when=${() => bots.length}
						><li><h4>Bots</h4></li><//
					>
					<${For} each=${() => bots}> ${(bot) => PickerBot(bot, () => picker.hidePopover())} <//>
				</ul>
				<input
					class="recipients"
					aria-label="Recipients"
					autocomplete="off"
					spellcheck="false"
					title="model:thinking@runner, comma between several"
					value=${() => compose.typed ?? recipients().map(formatAgent).join(', ')}
					onInput=${typeRecipients}
					onKeyDown=${(e) => {
						if (e.key === 'Enter') e.preventDefault()
					}}
				/>
			</div>
		</form>
	`
}

function PickerBot(bot, close) {
	const selected = () => recipients().some((p) => p.name === bot.name)
	return html`
		<li>
			<button
				type="button"
				class=${() => ['model', { on: selected() }]}
				onClick=${(e) => {
					const previous = recipients()
					selectRecipients(
						!e.shiftKey
							? [botAgent(bot)]
							: selected()
								? previous.filter((p) => p.name !== bot.name)
								: [...previous, botAgent(bot)],
					)
					if (!e.shiftKey) close()
				}}
			>
				<span style=${() => colorOf(bot.name)}>${() => bot.name}</span>
				<small>${() => formatAgent(bot.to)}</small>
			</button>
		</li>
	`
}

function PickerRunner(runner, close) {
	const choice = () => choiceFor(runner)
	const selected = () => recipients().some((p) => p.runner === runner.name && !p.name)
	const models = () => [
		...new Set([choice().model, runner.model, ...(runner.offers ?? [])].filter(Boolean)),
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
				<${Dot} state=${() => (runner.busy ? 'working' : 'on')} /><b>${() => runner.name}</b>
				<small title=${() => runner.dir}
					>${() =>
						runner.busy
							? `busy in ${runner.busy} thread${runner.busy > 1 ? 's' : ''}`
							: runner.dir}</small
				>
				<${Show} when=${() => runners.filter((r) => r.online).length > 1}>
					<button
						type="button"
						class="also"
						aria-pressed=${() => String(selected())}
						onClick=${() => choose(choice(), true)}
					>
						${() => (selected() ? 'asked' : 'ask too')}
					</button>
				<//>
			</div>
			<div class="models">
				<${For} each=${() => models()}
					>${(model) => html`
						<button
							type="button"
							class=${() => ['model', { on: selected() && model === choice().model }]}
							onClick=${(e) => {
								const to = { ...choice(), model }
								if (selected() && (e.shiftKey || recipients().length > 1)) configure(to)
								else choose(to, e.shiftKey)
								if (!e.shiftKey) close()
							}}
						>
							<span>${() => model.split('/').pop()}</span
							><small>${() => (model.includes('/') ? model.split('/')[0] : '')}</small>
						</button>
					`}<//
				>
			</div>
			<h4>Thinking</h4>
			<div class="steps">
				<${For} each=${() => THINKING_LEVELS}
					>${(level) => html`
						<button
							type="button"
							title=${() => level}
							aria-pressed=${() => String(choice().thinkingLevel === level)}
							onClick=${() =>
								configure({
									...choice(),
									thinkingLevel: choice().thinkingLevel === level ? undefined : level,
								})}
						>
							${() => ({ minimal: 'min', medium: 'med' })[level] ?? level}
						</button>
					`}<//
				>
			</div>
			<${Show} when=${() => runner.folders?.length > 1}>
				<h4>Folder</h4>
				<select
					aria-label="Folder"
					value=${() => choice().dir ?? ''}
					onChange=${(e) => configure({ ...choice(), dir: e.currentTarget.value || undefined })}
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
