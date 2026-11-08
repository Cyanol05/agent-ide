/** A bot's name, home, the agent it joins as, and instructions. */
import html from '@solidjs/html'
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
	snapshot,
} from 'solid-js'
import {
	api,
	bots,
	colorOf,
	current,
	followThread,
	hrefOf,
	openThread,
	reloadBots,
	threads,
} from './server.js'
import { formatAgent } from './agent.js'
import { agent, openPicker } from './composer.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { Sure } from './sure.js'
import { ThreadItem } from './thread-list.js'

export function BotItem(props) {
	const family = createMemo(() => {
		const home = threads.find((thread) => thread.id === props.bot.home)
		return threads.filter((thread) => home?.family.some((member) => member.id === thread.id))
	})
	const working = createMemo(() => family().filter((thread) => thread.status === 'working').length)
	const status = createMemo(
		() =>
			['working', 'blocked', 'error', 'done'].find((status) =>
				family().some((thread) => thread.status === status),
			) ?? 'idle',
	)
	return html`
		<li class=${() => ({ current: props.bot.home === current() })}>
			<a
				class="row"
				href=${() => hrefOf(props.bot.home)}
				title=${() => props.bot.instructions.split('\n')[0]}
				onClick=${(event) => followThread(event, props.bot.home)}
			>
				<${Dot} state=${() => status()} />
				<span style=${() => colorOf(props.bot.name)}>${() => props.bot.name}</span>
				<${Show} when=${() => working()}>
					<small title="Threads working">${() => working()}</small>
				<//>
			</a>
		</li>
	`
}

export function BotSettings(props) {
	let instructionsField
	const [instructions, setInstructions] = createSignal('')
	createEffect(
		() => props.bot.instructions,
		(instructions) => {
			if (document.activeElement !== instructionsField) setInstructions(instructions)
		},
	)
	// Its own threads, the home itself left out, plus the threads it joins elsewhere
	const own = createMemo(() => {
		const home = threads.find((thread) => thread.id === props.bot.home)
		const family = new Set((home?.family ?? []).map((member) => member.id))
		family.delete(props.bot.home)
		const mine = threads.filter((thread) => family.has(thread.id))
		const elsewhere = threads.filter(
			(thread) =>
				!family.has(thread.id) &&
				thread.id !== props.bot.home &&
				!thread.archived &&
				thread.agents.some((agent) => agent.name === props.bot.name),
		)
		return [...mine, ...elsewhere]
	})
	const count = createMemo(() => own().length)
	// Of its hundreds, the ones happening now or needing a hand; an unread answer already shows its dot in the thread list
	const active = createMemo(() =>
		own().filter((thread) => ['working', 'blocked', 'error'].includes(thread.status)),
	)
	return html`
		<div class="bot">
			<h3>Instructions</h3>
			<textarea
				class="field instructions"
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
						.then(() => reloadBots())
						.catch(report)}
			></textarea>
			<h3>Model</h3>
			<button
				type="button"
				class="field bot-model"
				title="The model it joins new threads with"
				onClick=${(event) => openPicker(event.currentTarget)}
			>
				${() => formatAgent(props.bot.to)}
			</button>
			${() => props.tools}
			<${Show} when=${() => count() > 0}>
				<h3>Threads</h3>
				<${Show} when=${() => active().length > 0}>
					<ul class="thread-family">
						<${For} each=${active}>${(thread) => html`<${ThreadItem} thread=${() => thread} />`}<//>
					</ul>
				<//>
				<button type="button" class="field threads" onClick=${(event) => props.onThreads(event)}>
					<span>${() => `All ${count()} ${count() === 1 ? 'thread' : 'threads'}`}</span>
					<small aria-hidden="true">→</small>
				</button>
			<//>
			<${Sure}
				class="forget"
				title="Every thread stays; agents of its name stop reading its instructions"
				ask=${() => `Forget ${props.bot.name}?`}
				why="Its instructions go; every thread stays."
				onConfirm=${async (_e) => {
					try {
						await api(`/api/bots/${encodeURIComponent(props.bot.name)}`, undefined, 'DELETE')
						reloadBots()
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
	const submit = async (event) => {
		event.preventDefault()
		if (saving()) return
		const entered = name().trim()
		if (!entered) return setError('Required')
		if (bots.some((bot) => bot.name === entered)) return setError('Taken')
		if (!/^[\w.-]{1,40}$/.test(entered)) return setError('Invalid')
		setSaving(true)
		try {
			const pick = snapshot(agent() ?? agent(null))
			if (!pick) throw new Error('Pick a model first in New thread')
			const { home } = await api('/api/bots', {
				name: entered,
				to: { ...pick, name: undefined },
			})
			reloadBots()
			openThread(home)
			props.onDone()
		} catch (failure) {
			setError(failure.message)
		} finally {
			setSaving(false)
		}
	}
	return html`
		<li>
			<form class="row" onSubmit=${submit}>
				<input
					ref=${(el) => {
						input = el
					}}
					aria-label="Bot name"
					placeholder="a name"
					enterkeyhint="go"
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					class=${() => ['bare', { bad: !!error() }]}
					aria-invalid=${() => !!error()}
					title=${() => error() || 'How anyone asks it, in any thread'}
					value=${() => name()}
					onInput=${(event) => {
						setName(event.currentTarget.value)
						setError('')
					}}
					onBlur=${() => {
						if (!saving() && !name().trim()) props.onDone()
					}}
					onKeyDown=${(event) => {
						if (event.key === 'Escape') props.onDone()
					}}
				/>
				<button type="submit" class="ghost small" disabled=${() => saving()}>Create</button>
				<${Show} when=${() => error()}>
					<small role="alert">${() => error()}</small>
				<//>
			</form>
		</li>
	`
}
