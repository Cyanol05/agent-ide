/**
 * The draft stays with the composer as you move between threads; a pick stays with its thread, since asking a thread's
 * agent as another model switches it. A pick is one model plus any bots; in a bot's home, it is the bot's model.
 */
import html from '@solidjs/html'
import {
	createEffect,
	createRoot,
	createStore,
	For,
	latest,
	refresh,
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
	entries,
	homeBot,
	openThread,
	runners,
	threads,
} from './server.js'
import { agentLabel, formatAgent, parseAgent, THINKING_LEVELS } from './agent.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { imageContent, imageUrl } from './images.js'

const [compose, setCompose] = createRoot(() =>
	createStore({ draft: '', images: [], sending: false, pick: null, typed: null, settings: {} }),
)
/** A pick, `{thread, agent, bots}`, belongs to the thread it was made in */
const pick = () => (compose.pick?.thread === current() ? compose.pick : null)
const here = () => threads.find((t) => t.id === current())?.agents ?? []
/** The names the thread asked last */
const lastTo = () => (entries[current()] ?? []).findLast((e) => e.data.to?.length)?.data.to
const fallback = (runner) =>
	compose.settings[runner.name] ?? { runner: runner.name, model: runner.model, thinkingLevel: 'low' }
/** Whom the next message asks as the agent: in a bot's home the bot, else the pick, else the thread's agent as it runs */
export const agent = () => {
	const bot = homeBot(current())
	if (bot) return botAgent(bot)
	if (pick()) return pick().agent
	if (lastTo() && !lastTo().some((n) => n.includes('@'))) return null
	const own = here().find((a) => a.to && !a.to.name)?.to
	const first = runners.find((r) => r.online) ?? runners[0]
	return own ?? (first?.model ? fallback(first) : null)
}
/** The bots it asks beside it: those picked, or those the thread asked last, as they run */
const askedBots = () =>
	homeBot(current())
		? []
		: (pick()?.bots ??
			here()
				.map((a) => a.to)
				.filter((to) => to?.name && lastTo()?.includes(to.name)))
export const recipients = () => [agent(), ...askedBots()].filter(Boolean)
/** What a runner's controls show: the agent asked, if it runs there, else what was last chosen there */
export const toFor = (runner) => (agent()?.runner === runner.name ? agent() : fallback(runner))
const setPick = (to, bots, typed = null) =>
	setCompose((s) => {
		s.pick = { thread: current(), agent: to, bots }
		s.typed = typed
		if (to && !to.name) s.settings[to.runner] = to
	})
/** Choosing a model replaces the agent's pick and keeps the bots; in a bot's home, it is the bot's own model */
export function choose(to, always = true) {
	const bot = homeBot(current())
	if (bot)
		return api('/api/bots', { name: bot.name, to: { ...to, name: undefined } })
			.then(() => refresh(bots))
			.catch(report)
	if (always || agent()?.runner === to.runner) setPick(to, snapshot(askedBots()))
	else setCompose((s) => void (s.settings[to.runner] = to))
}
/** A runner's settings change the agent's pick only when the agent is on that runner */
export const configure = (to) => choose(to, false)

/** The open thread's composer lends its model picker, so a bot's settings pick its model with the same one */
let lend
export const openPicker = (anchor) => lend?.(anchor)

export function Composer(props) {
	let input, picker, button, chooser, anchor
	const active = () => current() === props.thread
	const busy = () => here().some((a) => a.status === 'working')
	createEffect(active, (on) => {
		if (!on) return
		input.focus()
		lend = (from) => {
			if (picker.matches(':popover-open')) return picker.hidePopover()
			anchor = from
			picker.showPopover()
		}
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
				return here().find((a) => a.name === s)?.to ?? (bot ? botAgent(bot) : parseAgent(s))
			})
		setPick(next.find((to) => !to.name) ?? null, next.filter((to) => to.name), text)
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
						// What it asks stays as it was when the typing started
						if (!pick() && !homeBot(current())) setPick(snapshot(agent()), snapshot(askedBots()))
						setCompose((s) => {
							s.draft = e.currentTarget.value
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
							? `The model ${homeBot(current()).name} runs as`
							: recipients().map(formatAgent).join(', ')}
					onClick=${() => {
						openThread(props.thread)
						anchor = button
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
					if (e.newState === 'open') placePopover(picker, anchor ?? button)
					else anchor = button
				}}
			>
				<ul>
					<${For}
						each=${() => runners.filter((r) => r.online)}
						fallback=${html`<li class="mute">No runner is online.</li>`}
					>
						${(r) => PickerRunner(r, () => picker.hidePopover())}
					<//>
					<${Show} when=${() => !homeBot(current())}>
						<${Show} when=${() => bots.length}
							><li><h4>Bots</h4></li><//
						>
						<${For} each=${() => bots}> ${(bot) => PickerBot(bot, () => picker.hidePopover())} <//>
					<//>
				</ul>
				<${Show} when=${() => !homeBot(current())}>
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
				<//>
			</div>
		</form>
	`
}

/** A click asks only the bot; shift-click adds it beside the agent, or takes it off */
function PickerBot(bot, close) {
	const selected = () => askedBots().some((to) => to.name === bot.name)
	return html`
		<li>
			<button
				type="button"
				class=${() => ['model', { on: selected() }]}
				onClick=${(e) => {
					if (!e.shiftKey) return (setPick(null, [botAgent(bot)]), close())
					const others = askedBots().filter((to) => to.name !== bot.name)
					setPick(snapshot(agent()), selected() ? others : [...others, botAgent(bot)])
				}}
			>
				<span style=${() => colorOf(bot.name)}>${() => bot.name}</span>
				<small>${() => formatAgent(bot.to)}</small>
			</button>
		</li>
	`
}

function PickerRunner(runner, close) {
	const to = () => toFor(runner)
	const selected = () => agent()?.runner === runner.name
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
							class=${() => ['model', { on: selected() && agent().model === model }]}
							onClick=${() => {
								choose({ ...to(), model })
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
							aria-pressed=${() => String(to().thinkingLevel === level)}
							onClick=${() =>
								configure({
									...to(),
									thinkingLevel: to().thinkingLevel === level ? undefined : level,
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
					value=${() => to().dir ?? ''}
					onChange=${(e) => configure({ ...to(), dir: e.currentTarget.value || undefined })}
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
