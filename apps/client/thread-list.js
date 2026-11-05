/** The same thread row in the list, its family, and a bot's other threads. */
import html from '@solidjs/html'
import { createSignal, For, Show } from 'solid-js'
import { bots, current, deleteThread, homeBot, openThread, server, threads } from './server.js'
import { Dot } from './dot.js'
import { report } from './notice.js'
import { RunnerList } from './runner.js'
import { Settings } from './settings.js'
import { BotItem, NewBot } from './bot.js'

export function ThreadItem(props) {
	return html`
		<li
			title=${() => props.thread.title}
			style=${() => `--depth: ${props.depth ?? 0}`}
			class=${() => ({ current: props.thread.id === current() })}
			tabindex="0"
			onClick=${() => openThread(props.thread.id)}
			onKeyDown=${(event) => {
				if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
					event.preventDefault()
					openThread(props.thread.id)
				}
			}}
		>
			<${Dot} state=${() => props.thread.status} />
			<span>${() => props.thread.title || 'untitled'}</span>
			<${Show} when=${() => !homeBot(props.thread.id)}>
				<button
					title="Delete this thread"
					onClick=${(event) => {
						event.stopPropagation()
						deleteThread(props.thread.id).catch(report)
					}}
				>
					delete
				</button>
			<//>
		</li>
	`
}

export function ThreadList() {
	const [creating, setCreating] = createSignal(false)
	return html`
		<nav class="thread-list" aria-label="Threads">
			<button class=${() => ['new', { current: !current() }]} onClick=${() => openThread(null)}>
				+ New thread
			</button>
			<${Show} when=${() => server().modules.includes('bots')}>
				<h3>
					Bots
					<button type="button" onClick=${() => setCreating(true)}>+ new</button>
				</h3>
				<ul class="bots">
					<${Show} when=${() => creating()}><${NewBot} onDone=${(_e) => setCreating(false)} /><//>
					<${For} each=${() => bots}>${(bot) => html`<${BotItem} bot=${() => bot} />`}<//>
				</ul>
				<h3>Threads</h3>
			<//>
			<ul>
				<${For}
					each=${() =>
						threads.filter(
							(thread) => !thread.hidden && !homeBot(thread.id) && !threads.some((other) => other.id === thread.parent),
						)}
				>
					${(thread) => html`<${ThreadItem} thread=${() => thread} />`}
				<//>
			</ul>
			<footer class="list-foot">
				<${RunnerList} />
				<${Settings} />
			</footer>
		</nav>
	`
}
