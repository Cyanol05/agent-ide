/** A thread keeps its messages and live agent work only while it is on screen. */
import html from '@solidjs/html'
import { createEffect, createMemo, createStore, For, reconcile, Show } from 'solid-js'
import { current, fork, forkedFrom, me, openThread, threads, titleOf, watch } from './server.js'
import { authorLabel, lastToolCall, messageText } from './agent.js'
import { Composer } from './composer.js'
import { Dot } from './dot.js'

export const ThreadLink = (props) => html`
	<a
		class="thread-link"
		href=${() => {
			const next = new URL(location.href)
			next.searchParams.set('thread', props.id)
			return next.pathname + next.search
		}}
		onClick=${(e) => {
			e.preventDefault()
			openThread(props.id)
		}}
		>${() => props.children}</a
	>
`

export function Thread(props) {
	const t = createMemo(() => threads.find((t) => t.id === props.id))
	const [view, setView] = createStore({ entries: [], doing: {}, ready: false })
	let list,
		stuck = true
	createEffect(
		() => props.id,
		(id) => {
			if (!id) return
			let first = true
			return watch(
				(m) => {
					if (m.thread !== id) return
					stuck = !list || list.scrollTop + list.clientHeight >= list.scrollHeight - 4
					setView((v) => {
						if (m.entries) {
							if (first) reconcile(m.entries, 'id')(v.entries)
							else v.entries.push(...m.entries)
							first = false
							v.ready = true
						}
						if (m.live) v.doing[m.agent] = m.live
					})
				},
				(socket) => {
					first = true
					socket.send(JSON.stringify({ watch: id }))
				},
			)
		},
	)
	createEffect(
		() => [view.entries.length, Object.values(view.doing).map((d) => messageText(d.message))],
		() => {
			if (list && stuck) list.scrollTop = list.scrollHeight
		},
	)
	return html`
		<article
			class=${() => ['thread', { current: current() === props.id, 'hands-off': !!t()?.tools }]}
		>
			<header onClick=${(e) => {
				openThread(props.id)
				e.currentTarget.parentElement.querySelector('.box input').focus()
			}}>
				<span>${() => (props.id ? t()?.title || 'untitled' : 'a new thread')}</span>
				<${Dot} state=${() => t()?.status} />
			</header>
			<nav class="from">
				<${Show} when=${() => forkedFrom(t())}
					>${(id) => html`
						<${ThreadLink} id=${() => id()}>${() => `← forked from ${titleOf(id())}`}<//>
					`}<//
				>
			</nav>
			<ul
				ref=${(el) => {
					list = el
				}}
				aria-label="Messages"
			>
				<${Show} when=${() => props.id && !view.ready}
					><li class="mute">Asking for messages…</li><//
				>
				<${For} each=${() => view.entries}
					>${(m, i) => html`
						<${Message}
							thread=${() => props.id}
							entry=${() => m}
							previous=${() => view.entries[i() - 1]}
						/>
					`}<//
				>
				<${For} each=${() => t()?.agents ?? []}
					>${(a) => html`
						<${Show}
							when=${() => view.doing[a.name]?.run || ['working', 'blocked'].includes(a.status)}
						>
							<li class="writing">
								<small title=${() => lastToolCall(view.doing[a.name])}>
									<${Dot} state=${() => a.status} />
									${() => `${authorLabel(a.name)} · ${lastToolCall(view.doing[a.name]) || (a.status === 'blocked' ? 'blocked' : 'writing')}`}
								</small>
								${() => messageText(view.doing[a.name]?.message)}
							</li>
						<//>
					`}<//
				>
			</ul>
			<${Composer} thread=${() => props.id} />
		</article>
	`
}

function Message(props) {
	const data = () => props.entry.data
	const elsewhere = () => data().from && data().from !== props.thread
	const forks = () =>
		threads.filter(
			(t) =>
				!t.hidden && forkedFrom(t) === props.thread && t.conversation.parent.at === props.entry.id,
		)
	return html`
		<li
			class=${() => ({
				elsewhere: elsewhere(),
				reply: elsewhere() && data().re,
				mine: !elsewhere() && data().author === me,
				same:
					!elsewhere() &&
					data().author !== me &&
					!props.previous?.data.from &&
					props.previous?.data.author === data().author,
			})}
		>
			<${Show}
				when=${() => elsewhere() && data().re}
				fallback=${html`
					<${Show} when=${() => elsewhere()}>
						<div class="links">
							<${ThreadLink} id=${() => data().from}
								>${() => `→ asked from ${titleOf(data().from)}`}<//
							>
						</div>
					<//>
					<small title=${() => data().author}>${() => authorLabel(data().author)}</small>
					<span class="body">${() => data().body}</span>
				`}
			>
				<details>
					<summary>
						${() => authorLabel(data().author)} answered in
						<${ThreadLink} id=${() => data().from}>${() => titleOf(data().from)}<//>
					</summary>
					<span class="body">${() => data().body}</span>
				</details>
			<//>
			<${For} each=${() => forks()}
				>${(f) => html`
					<div class="links">
						<${ThreadLink} id=${() => f.id}>${() => `forked → ${f.title}`}<//>
					</div>
				`}<//
			>
			<button
				class="fork"
				title="A new thread from this message"
				onClick=${() => fork(props.thread, props.entry.id).catch((e) => alert(e.message))}
			>
				fork
			</button>
		</li>
	`
}
