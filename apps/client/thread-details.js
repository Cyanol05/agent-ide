/** Details and tools for the thread on screen, or the one about to start. */
import html from '@solidjs/html'
import { createEffect, createSignal, For, refresh, Show } from 'solid-js'
import {
	api,
	colorOf,
	current,
	drawer,
	entries,
	family,
	forkedFrom,
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
	const here = () => threads.find((t) => t.id === current())
	const members = () => [
		...new Set([
			...(entries[current()] ?? [])
				.filter((e) => !e.data.answer && !e.data.error && !e.data.from)
				.map((e) => e.data.author),
			...(here()?.readers ?? []),
		]),
		...(here()?.agents ?? []).map((a) => a.name),
	]
	const depth = (id) => {
		let d = 0
		for (let t = threads.find((t) => t.id === id); d < 20; d++) {
			const parent = t?.parent ?? forkedFrom(t)
			if (!family().includes(parent)) break
			t = threads.find((t) => t.id === parent)
		}
		return d
	}
	return html`
		<div class="scrim" onClick=${() => drawer(null)}></div>
		<section class="thread-details" aria-label="Thread details">
			<${Show} when=${current} keyed>${(id) => html`<${Title} thread=${id} />`}<//>
			<h3>In this thread</h3>
			<p id="members">
				<${For} each=${() => members()}>
					${(name, i) => [
						() => (i() ? ', ' : ''),
						html`<span title=${() => name} style=${() => colorOf(name)}
							>${() => authorLabel(name)}</span
						>`,
					]}
				<//>
			</p>
			<ul class="thread-family">
				<${For}
					each=${() =>
						family()
							.map((id) => threads.find((t) => t.id === id))
							.filter(Boolean)}
				>
					${(t) => html`<${ThreadItem} thread=${() => t} depth=${() => depth(t.id)} />`}
				<//>
			</ul>
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
	const title = () => threads.find((t) => t.id === props.thread)?.title ?? ''
	const [error, setError] = createSignal('')
	const save = async (field) => {
		const next = field.value.trim()
		if (next === title()) return
		setError('')
		try {
			await api(`/api/threads/${props.thread}/title`, { title: next })
			refresh(threads)
		} catch (e) {
			setError(e.message)
			field.value = title()
		}
	}
	return html`
		<input
			class=${() => ['thread-title', { bad: !!error() }]}
			aria-label="Thread title"
			title=${() => error() || 'Rename this thread'}
			value=${title}
			onChange=${(e) => save(e.currentTarget)}
			onKeyDown=${(e) => {
				if (e.key === 'Enter') e.currentTarget.blur()
				if (e.key === 'Escape') {
					e.currentTarget.value = title()
					e.currentTarget.blur()
				}
			}}
		/>
	`
}

function Tools(props) {
	const tools = () =>
		props.thread ? threads.find((t) => t.id === props.thread)?.tools : newThreadTools()
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
		} catch (e) {
			setError(e.message)
		}
	}
	return html`
		<div class="hands">
			<button
				type="button"
				aria-pressed=${() => String(!!tools())}
				title="Its agents read and ask others, and change nothing themselves"
				onClick=${() => apply(tools() ? null : HANDS_OFF)}
			>
				hands off
			</button>
			<input
				placeholder="every tool"
				aria-label="Thread tools"
				ref=${(el) => {
					field = el
				}}
				spellcheck="false"
				class=${() => ({ bad: !!error() })}
				title=${() => error() || 'tools, as pi --tools takes them: read,post or -write,-edit,-bash'}
				value=${() => text()}
				onInput=${(e) => setText(e.currentTarget.value)}
				onChange=${() =>
					apply(
						text()
							.split(/[\s,]+/)
							.filter(Boolean),
					)}
				onKeyDown=${(e) => {
					if (e.key === 'Enter') e.currentTarget.blur()
				}}
			/>
		</div>
	`
}
