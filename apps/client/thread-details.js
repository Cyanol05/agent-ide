/** Details and tools for the thread on screen, or the one about to start. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, Show } from 'solid-js'
import {
	api,
	colorOf,
	current,
	drawer,
	family,
	homeBot,
	newThreadTools,
	people,
	reloadThreads,
	setNewThreadTools,
	threads,
} from './server.js'
import { authorLabel } from './agent.js'
import { BotSettings } from './bot.js'
import { ThreadItem } from './thread-list.js'

export function ThreadDetails() {
	const here = () => threads.find((thread) => thread.id === current())
	// A bot's home is named for it already, so only who else is there
	const members = () =>
		[...(people[current()] ?? []), ...(here()?.agents ?? []).map((agent) => agent.name)].filter(
			(name) => name !== homeBot(current())?.name,
		)
	const depth = (id) => here()?.family.find((member) => member.id === id)?.depth ?? 0
	// A bot's threads are a page of their own: a bot with hundreds of them must not push its own settings off the sheet
	const [page, setPage] = createSignal(false)
	createEffect(current, () => {
		setPage(false)
	})
	// The page starts at its own top, wherever the settings had been scrolled to
	let sheet
	createEffect(page, (open) => {
		if (open) sheet.scrollTop = 0
	})
	const botThreads = () =>
		homeBot(current())
			? threads.filter((thread) => thread.id !== current() && family().includes(thread.id))
			: []
	/** Threads it works in that aren't its own family, each shown once */
	const alsoIn = () => {
		const bot = homeBot(current())
		if (!bot) return []
		return threads.filter(
			(thread) =>
				thread.id !== current() &&
				!thread.archived &&
				!family().includes(thread.id) &&
				thread.agents.some((agent) => agent.name === bot.name),
		)
	}
	// The same tools for whichever thread is on screen, mounted anew when it changes
	const tools = () =>
		html`<h2>Tools</h2><${For} each=${() => [current()]}>${(id) => html`<${Tools} thread=${id} />`}<//>`
	return html`
		<div class="scrim" onClick=${() => drawer(null)}></div>
		<section
			class="thread-details"
			aria-label="Thread details"
			ref=${(element) => (sheet = element)}
		>
			<button type="button" class="ghost close" aria-label="Close" onClick=${() => drawer(null)}>
				×
			</button>
			<${Show} when=${() => !page()}>
				<${Show} when=${current} keyed>${(id) => html`<${Title} thread=${id} />`}<//>
				<${Show} when=${() => members().length > 1}>
					<h2>In this thread</h2>
					<p id="members">
						<${For} each=${() => members()}>
							${(name, index) => [
								() => (index() ? ', ' : ''),
								html`<span title=${() => name} style=${() => colorOf(name)}
									>${() => authorLabel(name)}</span
								>`,
							]}
						<//>
					</p>
				<//>
				<${Show} when=${() => homeBot(current())} keyed
					>${(bot) =>
						html`<${BotSettings}
							bot=${() => bot}
							onThreads=${(_event) => setPage(true)}
							tools=${tools()}
						/>`}<//
				>
				<${Show} when=${() => !homeBot(current())}>
					<${Show} when=${() => family().length > 1}>
						<ul class="thread-family">
							<${For}
								each=${() =>
									family()
										.map((id) => threads.find((thread) => thread.id === id))
										.filter(Boolean)}
							>
								${(thread) =>
									html`<${ThreadItem} thread=${() => thread} depth=${() => depth(thread.id)} />`}
							<//>
						</ul>
					<//>
					${tools()}
				<//>
			<//>
			<${Show} when=${page}>
				<header class="page-head">
					<button type="button" class="ghost" aria-label="Back to the bot" onClick=${() => setPage(false)}>
						<span aria-hidden="true">←</span>
					</button>
					<h2>Threads</h2>
				</header>
				<ul class="thread-family">
					<${For} each=${botThreads}
						>${(thread) =>
							html`<${ThreadItem} thread=${() => thread} depth=${() => depth(thread.id) - 1} />`}<//
					>
				</ul>
				<${Show} when=${() => alsoIn().length}>
					<h2>Also in</h2>
					<ul class="thread-family">
						<${For} each=${alsoIn}
							>${(thread) => html`<${ThreadItem} thread=${() => thread} />`}<//
						>
					</ul>
				<//>
			<//>
		</section>
	`
}

/** Rename on Enter or leaving the field; Escape puts the old title back. */
function Title(props) {
	const title = () => threads.find((thread) => thread.id === props.thread)?.title ?? ''
	const [error, setError] = createSignal('')
	const save = async (field) => {
		const next = field.value.trim()
		if (next === title()) return
		setError('')
		try {
			await api(`/api/threads/${props.thread}/title`, { title: next })
			reloadThreads()
		} catch (failure) {
			setError(failure.message)
			field.value = title()
		}
	}
	return html`
		<input
			class=${() => ['thread-title', { bad: !!error() }]}
			aria-label="Thread title"
			title=${() => error() || 'Rename this thread'}
			value=${title}
			onChange=${(event) => save(event.currentTarget)}
			onKeyDown=${(event) => {
				if (event.key === 'Enter') event.currentTarget.blur()
				if (event.key === 'Escape') {
					event.currentTarget.value = title()
					event.currentTarget.blur()
				}
			}}
		/>
	`
}

function Tools(props) {
	const tools = () =>
		props.thread ? threads.find((thread) => thread.id === props.thread)?.tools : newThreadTools()
	let field
	const [text, setText] = createSignal('')
	createEffect(
		() => (tools() ?? []).join(','),
		(value) => {
			if (document.activeElement !== field) setText(value)
		},
	)
	const [error, setError] = createSignal('')
	const apply = async (list) => {
		setError('')
		try {
			if (props.thread) {
				await api(`/api/threads/${props.thread}/tools`, { tools: list?.length ? list : null })
				reloadThreads()
			} else setNewThreadTools(list?.length ? list : null)
		} catch (failure) {
			setError(failure.message)
		}
	}
	const here = () => props.thread && threads.find((thread) => thread.id === props.thread)
	const remember = async (on) => {
		setError('')
		try {
			await api(`/api/threads/${props.thread}/memory`, { on })
			reloadThreads()
		} catch (failure) {
			setError(failure.message)
		}
	}
	return html`
		<div class="hands">
			<label title="Its agents can look things up, but every change has to go through a thread">
				<input
					type="checkbox"
					checked=${() => !!tools()}
					onChange=${(event) => apply(event.currentTarget.checked ? HANDS_OFF : null)}
				/>
				Hands off
			</label>
			<input
				placeholder="every tool"
				aria-label="Thread tools"
				ref=${(el) => {
					field = el
				}}
				spellcheck="false"
				class=${() => ['tools', { bad: !!error() }]}
				title=${() => error() || 'tools, as pi --tools takes them: read,post or -write,-edit,-bash'}
				value=${() => text()}
				onInput=${(event) => setText(event.currentTarget.value)}
				onChange=${() =>
					apply(
						text()
							.split(/[\s,]+/)
							.filter(Boolean),
					)}
				onKeyDown=${(event) => {
					if (event.key === 'Enter') event.currentTarget.blur()
				}}
			/>
		</div>
		<${Show} when=${() => typeof here()?.memory === 'boolean'}>
			<div class="hands">
				<label
					title="Memory writes a line for each message, so its agents remember the whole thread"
				>
					<input
						type="checkbox"
						checked=${() => here().memory}
						onChange=${(event) => remember(event.currentTarget.checked)}
					/>
					Memory
				</label>
			</div>
		<//>
	`
}

const HANDS_OFF = ['-write', '-edit', '-bash']
