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
import { agentLabel, agentTo, formatAgent } from './agent.js'
import { placePopover } from './popover.js'
import { ModelPicker } from './model-picker.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { imageContent, imageUrl } from './images.js'

const [compose, setCompose] = createRoot(() =>
	createStore({ draft: '', images: [], sending: false, picks: {}, settings: {} }),
)
/** Each thread's pick, `{agent, bots, typed}`, kept by thread id; a new thread's under `new` */
const pick = (thread = current()) => compose.picks[thread ?? 'new'] ?? null
const here = (thread = current()) => threads.find((row) => row.id === thread)?.agents ?? []
/** The names the thread asked last */
const lastTo = (thread = current()) =>
	(entries[thread] ?? []).findLast((event) => event.data.to?.length)?.data.to
const fallback = (runner) =>
	compose.settings[runner.name] ?? { runner: runner.name, model: runner.model, thinkingLevel: 'low' }
/** Whom the next message asks as the agent: in a bot's home the bot, else the pick, else the thread's agent as it runs */
export const agent = (thread = current()) => {
	const bot = homeBot(thread)
	if (bot) return botAgent(bot)
	if (pick(thread)) return pick(thread).agent
	if (lastTo(thread) && !lastTo(thread).some((name) => name.includes('@'))) return null
	const own = here(thread).find((agent) => agent.to && !agent.to.name)?.to
	const first = runners.find((runner) => runner.online) ?? runners[0]
	return own ?? (first?.model ? fallback(first) : null)
}
/** The bots it asks beside it: those picked, or those the thread asked last, as they run */
const askedBots = (thread = current()) =>
	homeBot(thread)
		? []
		: (pick(thread)?.bots ??
			here(thread)
				.map((agent) => agent.to)
				.filter((to) => to?.name && lastTo(thread)?.includes(to.name)))
export const recipients = (thread = current()) => [agent(thread), ...askedBots(thread)].filter(Boolean)
/** What a runner's controls show: the agent asked, if it runs there, else what was last chosen there */
export const toFor = (runner, thread = current()) =>
	(agent(thread)?.runner === runner.name ? agent(thread) : fallback(runner))
const setPick = (to, bots, typed = null, thread = current()) =>
	setCompose((store) => {
		store.picks[thread ?? 'new'] = { agent: to, bots, typed }
		if (to && !to.name) store.settings[to.runner] = to
	})
/** Choosing a model replaces the agent's pick and keeps the bots; in a bot's home, it is the bot's own model */
export function choose(to, always = true, thread = current()) {
	const bot = homeBot(thread)
	if (bot)
		return api('/api/bots', { name: bot.name, to: { ...to, name: undefined } })
			.then(() => refresh(bots))
			.catch(report)
	if (always || agent(thread)?.runner === to.runner)
		setPick(to, snapshot(askedBots(thread)), null, thread)
	else setCompose((store) => void (store.settings[to.runner] = to))
}
/** A runner's settings change the agent's pick only when the agent is on that runner */
export const configure = (to, thread = current()) => choose(to, false, thread)

/** A bot's settings open the current composer's picker, which already edits that bot's agent. */
let lend
export const openPicker = (anchor) => lend?.(anchor)

export function Composer(props) {
	let input, picker, button, chooser, anchor
	const touch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
	const active = () => current() === props.thread
	const busy = () => threads.find((thread) => thread.id === props.thread)?.status === 'working'
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
				setCompose((store) => {
					store.images.push(image)
				})
			} catch (error) {
				report(error)
			}
		input.focus()
	}
	const imagesIn = (list) =>
		[...(list ?? [])]
			.filter((file) => file.kind !== 'string')
			.map((file) => file.getAsFile?.() ?? file)
			.filter((file) => file?.type.startsWith('image/'))
	const submit = async (event) => {
		event.preventDefault()
		if (compose.sending || !recipients(props.thread).length) return
		if (!compose.draft.trim() && !compose.images.length) return
		const body = compose.draft,
			images = snapshot(compose.images),
			to = snapshot(recipients(props.thread))
		let id = props.thread
		setCompose((store) => {
			store.sending = true
			store.draft = ''
			store.images = []
		})
		try {
			id ??= await createThread(body.slice(0, 60) || 'An image')
			await api(`/api/threads/${id}/entries`, {
				body,
				to,
				steer: true,
				...(images.length && { images }),
			})
		} catch (error) {
			setCompose((store) => {
				if (latest(current) !== id || store.draft || store.images.length) return
				store.draft = body
				store.images = images
			})
			report(error)
		} finally {
			setCompose((store) => {
				store.sending = false
			})
		}
	}
	const typeRecipients = (event) => {
		const text = event.currentTarget.value
		const next = text
			.split(',')
			.map((text) => text.trim())
			.filter(Boolean)
			.map((text) => {
				const bot = bots.find((bot) => bot.name === text)
				return (
					here(props.thread).find((agent) => agent.name === text)?.to ?? (bot ? botAgent(bot) : agentTo(text))
				)
			})
		setPick(next.find((to) => !to.name) ?? null, next.filter((to) => to.name), text, props.thread)
	}
	return html`
		<form
			class=${() => ({ compose: active(), elsewhere: !active() })}
			onSubmit=${submit}
			onDragOver=${(event) => {
				if ([...event.dataTransfer.types].includes('Files')) event.preventDefault()
			}}
			onDrop=${(event) => {
				const files = imagesIn(event.dataTransfer.files)
				if (!files.length) return
				event.preventDefault()
				openThread(props.thread)
				add(files)
			}}
		>
			<${Show} when=${() => active() && compose.images.length}>
				<ul class="images" aria-label="Images to send">
					<${For} each=${() => compose.images}
						>${(image, index) => html`
							<li>
								<img src=${() => imageUrl(image)} alt="" />
								<button
									type="button"
									aria-label="Take this image off"
									onClick=${(_e) =>
										setCompose((store) => {
											store.images.splice(index(), 1)
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
				<textarea
					ref=${(el) => (input = el)}
					rows="1"
					autocomplete="off"
					enterkeyhint=${() => (touch() ? 'enter' : 'send')}
					onKeyDown=${(event) => {
						if (event.key !== 'Enter' || event.isComposing || event.shiftKey || touch()) return
						submit(event)
					}}
					aria-label="Message"
					placeholder=${() =>
						homeBot(props.thread)
							? `Write to ${homeBot(props.thread).name}`
							: recipients(props.thread).length
								? 'Write a message'
								: 'Pick a model below, then write'}
					value=${() => (active() ? compose.draft : '')}
					onFocus=${() => {
						if (!active()) openThread(props.thread)
					}}
					onPaste=${(event) => {
						const files = imagesIn(event.clipboardData?.items)
						if (!files.length) return
						event.preventDefault()
						add(files)
					}}
					onInput=${(event) => {
						// What it asks stays as it was when the typing started
						if (!pick(props.thread) && !homeBot(props.thread))
							setPick(snapshot(agent(props.thread)), snapshot(askedBots(props.thread)), null, props.thread)
						setCompose((store) => {
							store.draft = event.currentTarget.value
						})
					}}
				></textarea>
				<${Show} when=${() => active()}>
					<button
						class="icon send"
						title="Send"
						aria-label="Send"
						disabled=${() => compose.sending || !recipients(props.thread).length}
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
					onChange=${(event) => {
						add(imagesIn(event.currentTarget.files))
						event.currentTarget.value = ''
					}}
				/>
				<${Show}
					when=${() =>
						active() &&
						threads.some((thread) => thread.id === props.thread && ['working', 'blocked'].includes(thread.status))}
				>
					<button
						type="button"
						class="icon"
						aria-label="Stop"
						title="Stop this thread"
						onClick=${() => api(`/api/threads/${props.thread}/stop`, {}).catch(report)}
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
						homeBot(props.thread)
							? `The model ${homeBot(props.thread).name} runs as`
							: recipients(props.thread).map(formatAgent).join(', ')}
					onClick=${() => {
						openThread(props.thread)
						anchor = button
						picker.togglePopover()
					}}
				>
					<${Dot} state=${() => (recipients(props.thread).length ? (busy() ? 'working' : 'on') : '')} />
					<span>${() => recipients(props.thread).map(agentLabel).join(' + ') || 'Pick a model'}</span>
				</button>
			</div>
			<div
				class="model-picker"
				popover
				ref=${(el) => (picker = el)}
				onToggle=${(event) => {
					button.setAttribute('aria-expanded', String(event.newState === 'open'))
					if (event.newState === 'open') placePopover(picker, anchor ?? button)
					else anchor = button
				}}
			>
				<${ModelPicker}
					getTo=${(runner) => toFor(runner, props.thread)}
					selectedRunner=${() => agent(props.thread)?.runner}
					onChoose=${(to) => {
						choose(to, true, props.thread)
						picker.hidePopover()
					}}
					onConfigure=${(to) => configure(to, props.thread)}
					folders=${true}
				>
					<${Show} when=${() => !homeBot(props.thread)}>
						<${Show} when=${() => bots.length}>
							<li><h3>Bots</h3></li>
						<//>
						<${For} each=${() => bots}> ${(bot) => PickerBot(bot, () => picker.hidePopover(), () => props.thread)} <//>
					<//>
				<//>
				<${Show} when=${() => !homeBot(props.thread)}>
				<input
					class="recipients"
					aria-label="Recipients"
					autocomplete="off"
					spellcheck="false"
					title="model:thinking@runner, and any bots' names, comma between them"
					value=${() => pick(props.thread)?.typed ?? recipients(props.thread).map(formatAgent).join(', ')}
					onInput=${typeRecipients}
					onKeyDown=${(event) => {
						if (event.key === 'Enter') event.preventDefault()
					}}
				/>
				<//>
			</div>
		</form>
	`
}

/** A click asks only the bot; shift-click adds it beside the agent, or takes it off */
function PickerBot(bot, close, thread) {
	const selected = () => askedBots(thread()).some((to) => to.name === bot.name)
	return html`
		<li>
			<button
				type="button"
				class=${() => ['model', { on: selected() }]}
				onClick=${(event) => {
					if (!event.shiftKey) return (setPick(null, [botAgent(bot)], null, thread()), close())
					const others = askedBots(thread()).filter((to) => to.name !== bot.name)
					setPick(
						snapshot(agent(thread())),
						selected() ? others : [...others, botAgent(bot)],
						null,
						thread(),
					)
				}}
			>
				<span style=${() => colorOf(bot.name)}>${() => bot.name}</span>
				<small>${() => formatAgent(bot.to)}</small>
			</button>
		</li>
	`
}

