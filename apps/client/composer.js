/**
 * Each thread keeps its draft, images and pick when you move away; a new thread keeps its own.
 * Asking a thread's agent as another model switches it. A pick is one model plus any bots; in a bot's home, it is the bot's model.
 */
import html from '@solidjs/html'
import {
	createEffect,
	createSignal,
	createRoot,
	createStore,
	For,
	onSettled,
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
	server,
	threads,
} from './server.js'
import { agentTo, formatAgent, writtenTo } from './agent.js'
import { placePopover } from './popover.js'
import { ModelPicker } from './model-picker.js'
import { Dot } from './dot.js'
import { conversations } from './run.js'
import { Compaction, Memory } from './agent-memory.js'
import { Panes } from './panes.js'
import { report } from './notice.js'
import { imageContent, imageUrl } from './images.js'

export function Composer(props) {
	let input, picker, button, chooser, anchor, recall, recallButton
	const [lines, setLines] = createSignal(false)
	const [compacting, setCompacting] = createSignal(false)
	/** How full the agent's context was at its last answer: tokens, and the share of its window */
	const filled = () => {
		const agent = here(props.thread).find((agent) => agent.contextWindow)
		const used = (conversations[agent?.conversation] ?? []).findLast(
			(entry) => entry.kind === 'pi.assistant',
		)?.model?.[0]?.usage?.totalTokens
		return used && { used, share: Math.round((used / agent.contextWindow) * 100) }
	}
	const compactNow = async () => {
		setCompacting(true)
		try {
			await api(`/api/threads/${props.thread}/compact`, {})
		} catch (error) {
			report(error)
		} finally {
			setCompacting(false)
		}
	}
	const draft = () => compose.drafts[props.thread ?? 'new'] ?? emptyDraft
	const changeDraft = (change, key = props.thread ?? 'new') =>
		setCompose((store) => {
			store.drafts[key] ??= { draft: '', images: [], sending: false }
			change(store.drafts[key])
		})
	const touch = () => matchMedia('(pointer: coarse)').matches
	const active = () => current() === props.thread
	const busy = () => threads.find((thread) => thread.id === props.thread)?.status === 'working'
	createEffect(
		() => [draft().draft, active()],
		() => {
			if (CSS.supports('field-sizing', 'content')) return
			onSettled(() => {
				input.style.height = 'auto'
				input.style.height = `${input.scrollHeight}px`
			})
		},
	)
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
		const key = props.thread ?? 'new'
		for (const file of files)
			try {
				const image = await imageContent(file)
				changeDraft((draft) => {
					draft.images.push(image)
				}, key)
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
		if (draft().sending || !recipients(props.thread).length) return
		if (!draft().draft.trim() && !draft().images.length) return
		const body = draft().draft,
			images = snapshot(draft().images),
			to = snapshot(recipients(props.thread))
		let id = props.thread
		const key = id ?? 'new'
		changeDraft((draft) => {
			draft.sending = true
			draft.draft = ''
			draft.images = []
		}, key)
		try {
			id ??= await createThread(body.slice(0, 60) || 'An image')
			await api(`/api/threads/${id}/entries`, {
				body,
				to,
				steer: true,
				...(images.length && { images }),
			})
		} catch (error) {
			changeDraft((draft) => {
				if (draft.draft || draft.images.length) return
				draft.draft = body
				draft.images = images
			}, id ?? key)
			report(error)
		} finally {
			changeDraft((draft) => {
				draft.sending = false
			}, key)
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
					here(props.thread).find((agent) => agent.name === text)?.to ??
					(bot ? botAgent(bot) : agentTo(text))
				)
			})
		setPick(
			next.find((to) => !to.name) ?? null,
			next.filter((to) => to.name),
			text,
			props.thread,
		)
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
			<${Show} when=${() => draft().images.length}>
				<ul class="images" aria-label="Images to send">
					<${For} each=${() => draft().images}
						>${(image, index) => html`
							<li>
								<img src=${() => imageUrl(image)} alt="" />
								<button
									type="button"
									aria-label="Take this image off"
									onClick=${(_e) =>
										changeDraft((draft) => {
											draft.images.splice(index(), 1)
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
					value=${() => draft().draft}
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
							setPick(
								snapshot(agent(props.thread)),
								snapshot(askedBots(props.thread)),
								null,
								props.thread,
							)
						changeDraft((draft) => {
							draft.draft = event.currentTarget.value
						})
					}}
				></textarea>
				<${Show} when=${() => active()}>
					<button
						class="icon send"
						title="Send"
						aria-label="Send"
						disabled=${() => draft().sending || !recipients(props.thread).length}
					>
						↑
					</button>
				<//>
			</div>
			<${Show} when=${() => missingBots(draft().draft, props.thread).length}>
				<div class="links missing">
					<${For} each=${() => missingBots(draft().draft, props.thread)}
						>${(bot, index) => html`${() =>
							index() ? (index() === missingBots(draft().draft, props.thread).length - 1 ? ' and ' : ', ') : ''}<span
								style=${() => colorOf(bot.name)}
								>${() => bot.name}</span
							>`}<//
					>
					${() => (missingBots(draft().draft, props.thread).length > 1 ? " aren't" : " isn't")} in this thread ·
					<button
						type="button"
						class="join"
						onClick=${() => addBots(missingBots(draft().draft, props.thread), props.thread)}
					>
						${() => (missingBots(draft().draft, props.thread).length > 1 ? 'Add all' : 'Add')}
					</button>
				</div>
			<//>
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
						threads.some(
							(thread) =>
								thread.id === props.thread && ['working', 'blocked'].includes(thread.status),
						)}
				>
					<button
						type="button"
						class="stop"
						aria-label="Stop"
						title="Stop this thread"
						onClick=${() => api(`/api/threads/${props.thread}/stop`, {}).catch(report)}
					>
						Stop
					</button>
				<//>
				<${Show} when=${() => filled()}>
					<button
						type="button"
						class="pick"
						aria-label="Context"
						title="How full the agent's context is"
						ref=${(el) => (recallButton = el)}
						onClick=${() => {
							openThread(props.thread)
							recall.togglePopover()
						}}
					>
						<span>${() => `${filled().share}% · ${Math.round(filled().used / 1000)}k`}</span>
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
					<${Dot}
						state=${() => (recipients(props.thread).length ? (busy() ? 'working' : 'on') : '')}
					/>
					<span
						>${() =>
							recipients(props.thread)
								.map((to) => recipientLabel(to, props.thread))
								.join(' + ') || 'Pick a model'}</span
					>
				</button>
			</div>
			<div
				class="settings recall"
				popover
				ref=${(el) => (recall = el)}
				onToggle=${(event) => {
					if (event.newState === 'open') placePopover(recall, recallButton)
					else setLines(false)
				}}
			>
				<${Show} when=${() => active()}>
					<${Panes}
						title="Context"
						detailTitle="Memory’s lines"
						actions=${html`<button type="button" onClick=${() => recall.hidePopover()}>Done</button>`}
						open=${() => lines()}
						onBack=${() => setLines(false)}
						detail=${html`<${Show} when=${() => lines()}><${Memory} /><//>`}
					>
						<${Compaction} />
						<${Show} when=${() => server().modules?.includes('memory')}>
							<ul class="modules">
								<li
									role="button"
									tabindex="0"
									onClick=${() => setLines(true)}
									onKeyDown=${(event) => event.key === 'Enter' && setLines(true)}
								>
									<div>
										<b>Inspect memory</b>
										<small>The lines the agent reads instead of its old messages.</small>
									</div>
									<span aria-hidden="true">›</span>
								</li>
							</ul>
						<//>
						<button
							type="button"
							class="save"
							disabled=${() => compacting()}
							title=${() =>
								server().modules?.includes('memory')
									? 'The agent reads the memory lines instead of the old messages'
									: 'Pi summarises the old messages, which costs a model call'}
							onClick=${compactNow}
						>
							${() => (compacting() ? 'Compacting…' : 'Compact now')}
						</button>
					<//>
				<//>
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
						<${For} each=${() => bots}>
							${(bot) =>
								PickerBot(
									bot,
									() => picker.hidePopover(),
									() => props.thread,
								)}
						<//>
					<//>
				<//>
				<${Show} when=${() => !homeBot(props.thread)}>
					<input
						class="recipients"
						aria-label="Recipients"
						autocomplete="off"
						autocapitalize="none"
						autocorrect="off"
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

const [compose, setCompose] = createRoot(() => createStore({ drafts: {}, picks: {}, settings: {} }))
const emptyDraft = { draft: '', images: [], sending: false }
/** Each thread's pick, `{agent, bots, typed}`, kept by thread id; a new thread's under `new` */
const pick = (thread = current()) => compose.picks[thread ?? 'new'] ?? null
const here = (thread = current()) => threads.find((row) => row.id === thread)?.agents ?? []
/** The names the thread asked last */
const lastTo = (thread = current()) =>
	(entries[thread] ?? []).findLast((event) => event.data.to?.length)?.data.to
const fallback = (runner) =>
	compose.settings[runner.name] ?? { runner: runner.name, model: runner.model }
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
/** The bots a message @mentions that exist but aren't in the thread, and aren't picked to be */
export const missingBots = (body, thread = current()) => {
	const mentioned = [...String(body).matchAll(/@([\w.-]+)/g)].map(([, name]) =>
		name.replace(/\.+$/, '').toLowerCase(),
	)
	if (!mentioned.length || homeBot(thread)) return []
	const inside = (bot) =>
		here(thread).some((agent) => agent.to?.name === bot.name) ||
		askedBots(thread).some((to) => to.name === bot.name)
	return bots.filter((bot) => mentioned.includes(bot.name.toLowerCase()) && !inside(bot))
}
/** Bringing mentioned bots in is picking them in the picker: the next message asks them */
export const addBots = (list, thread = current()) =>
	setPick(null, list.map(botAgent), null, thread)
export const recipients = (thread = current()) =>
	[agent(thread), ...askedBots(thread)].filter(Boolean)
/** An agent asked without thinking keeps the running level, or uses the runner's known pi default. */
const recipientLabel = (to, thread) => {
	const running = here(thread).find(
		(agent) =>
			agent.to?.name === to.name && agent.to?.model === to.model && agent.to?.runner === to.runner,
	)?.to
	const runner = runners.find((runner) => runner.name === to.runner)
	return writtenTo({
		...to,
		thinkingLevel: to.thinkingLevel ?? (running ? running.thinkingLevel : runner?.thinkingLevel),
	})
}
/** What a runner's controls show: the agent asked, if it runs there, else what was last chosen there */
export const toFor = (runner, thread = current()) =>
	agent(thread)?.runner === runner.name ? agent(thread) : fallback(runner)
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
