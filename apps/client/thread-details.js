/** Details and tools for the thread on screen, or the one about to start. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, refresh, Show } from 'solid-js'
import {
	api,
	colorOf,
	current,
	drawer,
	family,
	homeBot,
	newThreadTools,
	setNewThreadTools,
	threads,
} from './server.js'
import { authorLabel } from './agent.js'
import { BotSettings } from './bot.js'
import { ThreadItem } from './thread-list.js'

const HANDS_OFF = ['-write', '-edit', '-bash']
export function ThreadDetails() {
	const here = () => threads.find((thread) => thread.id === current())
	// A bot's home is named for it already, so only who else is there
	const members = () =>
		[...(here()?.people ?? []), ...(here()?.agents ?? []).map((agent) => agent.name)].filter(
			(name) => name !== homeBot(current())?.name,
		)
	const depth = (id) => here()?.family.find((member) => member.id === id)?.depth ?? 0
	return html`
		<div class="scrim" onClick=${() => drawer(null)}></div>
		<section class="thread-details" aria-label="Thread details">
			<${Show} when=${current} keyed>${(id) => html`<${Title} thread=${id} />`}<//>
			<${Show} when=${() => members().length > 1}>
				<h3>In this thread</h3>
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
			<${Show} when=${() => family().length > 1}>
				<ul class="thread-family">
					<${For}
						each=${() =>
							family()
								.map((id) => threads.find((thread) => thread.id === id))
								.filter(Boolean)}
					>
						${(thread) => html`<${ThreadItem} thread=${() => thread} depth=${() => depth(thread.id)} />`}
					<//>
				</ul>
			<//>
			<h3>Tools</h3>
			<${For} each=${() => [current()]}> ${(id) => html`<${Tools} thread=${id} />`} <//>
			<${Show} when=${() => homeBot(current())} keyed>
				${(bot) => html`<${BotSettings} bot=${() => bot} />`}
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
			refresh(threads)
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
				refresh(threads)
			} else setNewThreadTools(list?.length ? list : null)
		} catch (failure) {
			setError(failure.message)
		}
	}
	return html`
		<div class="hands">
			<label title="Its agents read and ask others, and change nothing themselves">
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
	`
}
