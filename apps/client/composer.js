/**
 * The draft stays with the composer as you move between threads; a pick belongs to the thread it was made in, since asking
 * a thread's agent with another model switches it. A thread has one agent, so a pick is one model, plus any bots.
 */
import html from '@solidjs/html'
import {
	createEffect,
	createRoot,
	createStore,
	For,
	latest,
	Show,
	snapshot,
} from 'solid-js'
import {
	api,
	bots,
	botAgent,
	colorOf,
	createThread,
	current,
	drawer,
	entries,
	homeBot,
	openThread,
	runners,
	threads,
} from './server.js'
import { agentLabel, formatAgent, parseAgent, sameAgent, THINKING_LEVELS } from './agent.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { imageContent, imageUrl } from './images.js'

const [compose, setCompose] = createRoot(() =>
	createStore({
		draft: '',
		images: [],
		sending: false,
		to: null,
		/** The thread `to` was picked in */
		for: null,
		typed: null,
		settings: {},
	}),
)
const picked = () => (compose.to && compose.for === current() ? compose.to : null)
const agentsHere = () => threads.find((t) => t.id === current())?.agents ?? []
/** The thread's own agent, as it runs */
const ownAgent = () => agentsHere().find((a) => a.to && !a.to.name)?.to
export const choiceFor = (r) => {
	const bot = homeBot(current())
	const mine = bot ? [botAgent(bot)] : (picked() ?? (ownAgent() ? [ownAgent()] : []))
	return (
		mine.find((p) => p.runner === r.name && (bot || !p.name)) ??
		compose.settings[r.name] ?? { runner: r.name, model: r.model, thinkingLevel: 'low' }
	)
}
/** Whom the thread asked last, as they are now: a message without a pick asks them again, at the level they think at */
const askedLast = () => {
	const names = (entries[current()] ?? []).findLast((e) => e.data.to?.length)?.data.to ?? []
	return agentsHere()
		.filter((a) => a.to && names.some((n) => (n.includes('@') ? !a.to.name : a.to.name === n)))
		.map((a) => a.to)
}
export const recipients = () => {
	const bot = homeBot(current())
	if (bot) return [botAgent(bot)]
	if (picked()) return picked()
	const last = askedLast()
	if (last.length) return last
	const home = runners.find((r) => r.online) ?? runners[0]
	return home?.model ? [choiceFor(home)] : []
}
export const selectRecipients = (to) =>
	setCompose((s) => {
		s.to = to
		s.for = current()
		s.typed = null
	})
/** Choosing a model replaces the thread's agent's pick, and keeps any bots beside it */
export function choose(to) {
	const next = [to, ...recipients().filter((p) => p.name)]
	setCompose((s) => {
		s.to = next
		s.for = current()
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
			s.for = current()
			s.typed = null
		}
	})
}

export function Composer(props) {
	let input, picker, button, chooser
	const active = () => current() === props.thread
	const agents = () => threads.find((t) => t.id === current())?.agents ?? []
	const busy = () =>
		agents().some((a) => a.status === 'working' && recipients().some((p) => sameAgent(a.to, p)))
	createEffect(active, (on) => {
		if (on) input.focus()
	})
	/** Pasted, dropped or picked: each image waits above the box until it's sent or taken off */
	const add = async (files) => {
		for (const file of files)
			try {
				const image = await imageContent(file)
				setCompose((s) => {
					s.images.push(image)
				})
			} catch (error) {
				report(error)
			}
		input.focus()
	}
	const imagesIn = (list) =>
		[...(list ?? [])]
			.filter((f) => f.kind !== 'string')
			.map((f) => f.getAsFile?.() ?? f)
			.filter((f) => f?.type.startsWith('image/'))
	const submit = async (e) => {
		e.preventDefault()
		if (compose.sending || !recipients().length) return
		if (!compose.draft.trim() && !compose.images.length) return
		const body = compose.draft,
			images = snapshot(compose.images),
			to = snapshot(recipients())
		let id = current()
		setCompose((s) => {
			s.sending = true
			s.draft = ''
			s.images = []
		})
		try {
			id ??= await createThread(body.slice(0, 60) || 'An image')
			await api(`/api/threads/${id}/entries`, {
				body,
				to,
				...(images.length && { images }),
			})
		} catch (error) {
			setCompose((s) => {
				if (latest(current) !== id || s.draft || s.images.length) return
				s.draft = body
				s.images = images
			})
			report(error)
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
			s.for = current()
			s.typed = text
			for (const to of next) if (!to.name) s.settings[to.runner] = to
		})
	}
	return html`
		<form
			class=${() => ({ compose: active(), elsewhere: !active() })}
			onSubmit=${submit}
			onDragOver=${(e) => {
				if ([...e.dataTransfer.types].includes('Files')) e.preventDefault()
			}}
			onDrop=${(e) => {
				const files = imagesIn(e.dataTransfer.files)
				if (!files.length) return
				e.preventDefault()
				openThread(props.thread)
				add(files)
			}}
		>
			<${Show} when=${() => active() && compose.images.length}>
				<ul class="images" aria-label="Images to send">
					<${For} each=${() => compose.images}
						>${(image, i) => html`
							<li>
								<img src=${() => imageUrl(image)} alt="" />
								<button
									type="button"
									aria-label="Take this image off"
									onClick=${(_e) =>
										setCompose((s) => {
											s.images.splice(i(), 1)
										})}
								>
									×
								</button>
							</li>
						`}<//
					>
				</ul>
			<//>
			<div class="box">
				<input
					ref=${(el) => (input = el)}
					autocomplete="off"
					enterkeyhint="send"
					aria-label="Message"
					placeholder=${() =>
						homeBot(props.thread)
							? `Write to ${homeBot(props.thread).name}`
							: !active() || recipients().length
								? 'Write a message'
								: 'Pick a model below, then write'}
					value=${() => (active() ? compose.draft : '')}
					onFocus=${() => {
						if (!active()) openThread(props.thread)
					}}
					onPaste=${(e) => {
						const files = imagesIn(e.clipboardData?.items)
						if (!files.length) return
						e.preventDefault()
						add(files)
					}}
					onInput=${(e) => {
						const to = !picked() && !homeBot(current()) ? snapshot(recipients()) : null
						setCompose((s) => {
							s.draft = e.currentTarget.value
							if (to?.length) [s.to, s.for] = [to, current()]
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
					title="Add images; you can also paste or drop them"
					aria-label="Add images"
					onClick=${(_e) => {
						openThread(props.thread)
						chooser.click()
					}}
				>
					+
				</button>
				<input
					type="file"
					accept="image/*"
					multiple
					hidden
					ref=${(el) => (chooser = el)}
					onChange=${(e) => {
						add(imagesIn(e.currentTarget.files))
						e.currentTarget.value = ''
					}}
				/>
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
						onClick=${() => api(`/api/threads/${current()}/stop`, {}).catch(report)}
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
					title=${() =>
						homeBot(current())
							? "Its home asks the bot: change its model in the bot's settings"
							: recipients().map(formatAgent).join(', ')}
					onClick=${() => {
						openThread(props.thread)
						// A bot's model is the bot's: its settings are where it changes
						if (homeBot(current())) {
							drawer('side')
							requestAnimationFrame(() =>
								document.querySelector('.thread-details .bot input.model')?.focus(),
							)
						} else picker.togglePopover()
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
					title="model:thinking@runner, and any bots' names, comma between them"
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
	const selected = () =>
		recipients().some(
			(p) => p.runner === runner.name && (!p.name || p.name === homeBot(current())?.name),
		)
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
			</div>
			<div class="models">
				<${For} each=${() => models()}
					>${(model) => html`
						<button
							type="button"
							class=${() => [
								'model',
								{
									on: recipients().some(
										(p) => p.runner === runner.name && p.model === model && !p.name,
									),
								},
							]}
							onClick=${() => {
								choose({ ...choice(), model })
								close()
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
