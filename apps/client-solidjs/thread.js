/** A thread owns its message subscription while it is on screen. */
import html from '@solidjs/html'
import { createEffect, createMemo, createStore, For, reconcile, Show } from 'solid-js'
import { current, fork, forkedFrom, me, openThread, threads, titleOf, watch } from './server.js'
import { authorLabel, doing, lastToolCall, messageText, setDoing } from './agent.js'
import { Composer } from './composer.js'
import { Dot } from './dot.js'

export const ThreadLink = (props) => html`
	<a class="thread-link" href=${() => {
		const next = new URL(location.href)
		next.searchParams.set('thread', props.id)
		return next.pathname + next.search
	}} onClick=${(e) => { e.preventDefault(); openThread(props.id) }}>${() => props.children}</a>
`

export function Thread(props) {
	const thread = createMemo(() => threads.find((t) => t.id === props.id))
	const [view, setView] = createStore({ entries: [], ready: false })
	let list, stuck = true
	createEffect(() => props.id, (id) => {
		if (!id) return
		let first = true
		const close = watch((m) => {
			if (m.thread !== id) return
			stuck = !list || list.scrollTop + list.clientHeight >= list.scrollHeight - 4
			if (m.entries) setView((v) => {
				if (first) reconcile(m.entries, 'id')(v.entries)
				else v.entries.push(...m.entries)
				first = false
				v.ready = true
			})
			if (m.live) setDoing((work) => {
				work[id] ??= {}
				work[id][m.agent] = m.live
			})
		}, (socket) => { first = true; socket.send(JSON.stringify({ watch: id })) })
		return () => { close(); setDoing((work) => { delete work[id] }) }
	})
	createEffect(
		() => [view.entries.length, Object.values(doing[props.id] ?? {}).map((d) => messageText(d.message))],
		() => { if (list && stuck) list.scrollTop = list.scrollHeight },
	)
	return html`
		<article data-thread=${() => props.id} class=${() => ['thread', { current: current() === props.id, 'hands-off': !!thread()?.tools }]}>
			<header onClick=${(e) => {
				openThread(props.id)
				e.currentTarget.parentElement.querySelector('.box input').focus()
			}}>
				<span>${() => props.id ? thread()?.title || 'untitled' : 'a new thread'}</span>
				<${Dot} state=${() => thread()?.status} />
			</header>
			<nav class="from">
				<${Show} when=${() => forkedFrom(thread())}>${(id) => html`
					<${ThreadLink} id=${() => id()}>${() => `← forked from ${titleOf(id())}`}<//>
				`}<//>
			</nav>
			<${Show} when=${() => props.id}>
			<ul ref=${(el) => { list = el }} aria-label="Messages">
				<${Show} when=${() => props.id && !view.ready}><li class="mute">Asking for messages…</li><//>
				<${For} each=${() => view.entries}>${(message, index) => html`
					<${Message} thread=${() => props.id} entry=${() => message} previous=${() => view.entries[index() - 1]} />
				`}<//>
				<${For} each=${() => thread()?.agents ?? []}>${(agent) => html`
					<${Writing} agent=${() => agent} live=${() => doing[props.id]?.[agent.name]} />
				`}<//>
			</ul>
			<//>
			<${Composer} thread=${() => props.id} />
		</article>
	`
}

const Writing = (props) => html`
	<${Show} when=${() => props.live?.run || ['working', 'blocked'].includes(props.agent.status)}>
		<li class="writing">
			<small title=${() => lastToolCall(props.live)}>
				<${Dot} state=${() => props.agent.status} />
				${() => `${authorLabel(props.agent.name)} · ${lastToolCall(props.live) || (props.agent.status === 'blocked' ? 'blocked' : 'writing')}`}
			</small>
			${() => messageText(props.live?.message)}
		</li>
	<//>
`

function Message(props) {
	const data = () => props.entry.data
	const elsewhere = () => data().from && data().from !== props.thread
	const forks = () => threads.filter((t) => !t.hidden && forkedFrom(t) === props.thread && t.conversation.parent.at === props.entry.id)
	return html`
		<li class=${() => ({
			elsewhere: elsewhere(), reply: elsewhere() && data().re,
			mine: !elsewhere() && data().author === me,
			same: !elsewhere() && data().author !== me && !props.previous?.data.from && props.previous?.data.author === data().author,
		})}>
			<${Show} when=${() => elsewhere() && data().re} fallback=${html`
				<${Show} when=${() => elsewhere()}>
					<div class="links"><${ThreadLink} id=${() => data().from}>${() => `→ asked from ${titleOf(data().from)}`}<//></div>
				<//>
				<small title=${() => data().author}>${() => authorLabel(data().author)}</small>
				<span class="body">${() => data().body}</span>
			`}>
				<details>
					<summary>${() => authorLabel(data().author)} answered in <${ThreadLink} id=${() => data().from}>${() => titleOf(data().from)}<//></summary>
					<span class="body">${() => data().body}</span>
				</details>
			<//>
			<${For} each=${() => forks()}>${(f) => html`
				<div class="links"><${ThreadLink} id=${() => f.id}>${() => `forked → ${f.title}`}<//></div>
			`}<//>
			<button class="fork" title="A new thread from this message"
				onClick=${() => fork(props.thread, props.entry.id).catch((e) => alert(e.message))}>fork</button>
		</li>
	`
}
