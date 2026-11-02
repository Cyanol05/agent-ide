/** The web client on the page's stage */
import './agent-memory.js'
import { wires } from './wires.js'
import { $, h, dotClass, drawer, phone } from './dom.js'
import { agentKey, authorLabel, lastToolCall, sameAgent } from './agent.js'
import {
	bots,
	colorOf,
	connected,
	current,
	doing,
	entries,
	family,
	focused,
	forkedFrom,
	homeBot,
	modules,
	newThreadTools,
	onChange,
	openThread,
	params,
	peopleIn,
	recipients,
	refresh,
	runnerSettings,
	runners,
	setNewThreadTools,
	setThreadTools,
	threads,
	url,
	wantsFocus,
	watchServer,
} from './state.js'
import { NewThread, Thread, ThreadItem, Tools, threadNodes } from './thread.js'
import { BotItem, BotSettings, NewBot } from './bot.js'
import { Runner, RunnerCount, drawRunnerList } from './runner.js'
import { drawComposer, form, pickButton } from './composer.js'

/** Just the chat, or the chat beside the story; the link remembers which */
const setChatOnly = (chat) => {
	document.body.classList.toggle('chat', chat)
	$('mode').textContent = chat ? 'With the story' : 'Just the chat'
	const next = new URL(location.href)
	if (chat) next.searchParams.set('chat', '')
	else next.searchParams.delete('chat')
	history.replaceState(null, '', next)
	dispatchEvent(new Event('resize'))
}
$('mode').onclick = () => setChatOnly(!document.body.classList.contains('chat'))
setChatOnly(params.has('chat'))
$('back').onclick = () => drawer('list')
$('pill').onclick = () => drawer('side')
$('scrim').onclick = () => drawer(null)
addEventListener('keydown', (e) => {
	if (e.key === 'Escape') drawer(null)
})
phone.addEventListener('change', () => {
	drawer(null)
	render()
})

/** The thread's details hold its tools, for the thread on screen or the one about to start */
const threadTools = Tools(null, (tools) =>
	current ? setThreadTools(tools) : setNewThreadTools(tools),
)
$('side').append(h('h3', { textContent: 'Tools' }), threadTools, BotSettings(null))

/** Every thread on the server, newest first; a new one always on top */
function ThreadList() {
	const homes = new Set(bots.map((b) => b.home))
	const newBot = () => {
		const item = NewBot()
		$('list').querySelector('ul.bots').prepend(item)
		item.firstChild.focus()
	}
	return [
		h('button', {
			className: `new${current ? '' : ' current'}`,
			textContent: '+ New thread',
			onclick: () => openThread(null),
		}),
		...(modules?.includes('bots')
			? [
					h(
						'h3',
						{},
						'Bots',
						h('button', { type: 'button', textContent: '+ new', onclick: newBot }),
					),
					h('ul', { className: 'bots' }, ...bots.map(BotItem)),
					h('h3', { textContent: 'Threads' }),
				]
			: []),
		h(
			'ul',
			{},
			...threads
				.filter((t) => !t.hidden && !homes.has(t.id) && !threads.some((p) => p.id === t.parent))
				.map((t) => ThreadItem(t)),
		),
		$('runner-count'),
	]
}
/** Who's here, named as their messages name them */
const Members = (here) =>
	[...peopleIn(current), ...(here?.agents ?? []).map((a) => a.name)].flatMap((n, i) => [
		i ? ', ' : '',
		h('span', { title: n, style: colorOf(n) }, authorLabel(n)),
	])

function render() {
	if ($('memory').getAttribute('thread') !== String(current ?? ''))
		$('memory').setAttribute('thread', current ?? '')
	$('server').classList.toggle('off', !connected)
	$('server').querySelector('.dot').className = dotClass(connected ? 'on' : '')
	$('server').querySelector('code').textContent = url
	/** Another machine can't reach localhost; it needs the server's name on the network */
	const reachable = /^https?:\/\/(localhost|127\.|\[::1\])/.test(url)
		? url.replace(/\/\/[^:/]+/, '//yourbox')
		: url
	$('lend').textContent = `curl -fsSL ${reachable}/connect-runner | sh -s -- --dir ~/code`

	const shown = family()
	const shownThreads = shown.map((id) => threads.find((t) => t.id === id)).filter(Boolean)
	/** Moved only when they change: taking a thread out and back would lose the cursor in it */
	const next = [...shown.map(Thread), ...(current ? [] : [NewThread()])]
	if (
		next.length !== $('threads').children.length ||
		next.some((b, i) => $('threads').children[i] !== b)
	)
		$('threads').replaceChildren(...next)
	if (wantsFocus && (!current || entries.has(current))) {
		focused()
		form.querySelector('input').focus()
	}
	if (!$('list').contains(document.activeElement) || document.activeElement.tagName !== 'INPUT')
		$('list').replaceChildren(...ThreadList())

	/** The phone's bar names the thread */
	const here = threads.find((t) => t.id === current)
	$('pill').lastChild.textContent = current ? here?.title || 'untitled' : 'New thread'
	$('pill').firstChild.className = dotClass(here?.status)
	$('pill').classList.toggle('hands-off', Boolean(current ? here?.tools : newThreadTools))
	threadTools.show(current ? here?.tools : newThreadTools)
	const depth = (id) => {
		let d = 0
		for (let t = threads.find((x) => x.id === id); d < 20; d++) {
			const p = t?.parent ?? forkedFrom(t)
			if (!shown.includes(p)) break
			t = threads.find((x) => x.id === p)
		}
		return d
	}
	$('family').replaceChildren(...shownThreads.map((t) => ThreadItem(t, depth(t.id))))
	BotSettings(homeBot(current))
	$('members').replaceChildren(...Members(here))

	drawComposer()
	$('runner-count').replaceChildren(...RunnerCount())
	drawRunnerList()

	/** A runner is one card: click it to ask it, shift-click to ask it too */
	const asked = shownThreads.flatMap((t) => t.agents.map((a) => ({ ...a, thread: t.id })))
	const sig = JSON.stringify([
		runners.map((r) => [r.name, r.online, r.dir, r.model, r.offers]),
		recipients(),
		runnerSettings,
		asked.map((a) => [a.thread, a.name, a.status]),
		asked.map((a) => lastToolCall(doing.get(`${a.thread} ${a.name}`))),
	])
	if ($('runners').dataset.sig !== sig) {
		$('runners').dataset.sig = sig
		$('runners').replaceChildren(...runners.map((r) => Runner(r, asked)))
	}
	drawWires(shownThreads)
}

/** Only the connections live here; wires owns their geometry */
const canvas = wires($('canvas'))
function drawWires(shownThreads) {
	const asking = recipients()
	const down = { fromSide: 'bottom', toSide: 'top', fromAt: 'to' }
	const row = (to) => $('runners').querySelector(`[data-agent="${CSS.escape(agentKey(to))}"]`)
	const state = (s) => (!s || s === 'idle' ? '' : s)
	const connections = [
		{
			from: $('client'),
			to: $('server'),
			fromSide: 'right',
			toSide: 'left',
			fromAt: 18,
			toAt: 18,
			className: connected ? '' : 'off',
		},
	]
	/** A runner a thread wires to needs no wire of its own from the server */
	const reached = new Set([
		...asking.map((p) => p.runner),
		...shownThreads.flatMap((t) => t.agents.map((a) => a.to.runner)),
	])
	for (const r of runners)
		if (!reached.has(r.name))
			connections.push({
				...down,
				from: $('server'),
				to: $(`runner-${r.name}`),
				toAt: 40,
				className: connected && r.online ? '' : 'off',
			})
	for (const t of shownThreads) {
		const from = threadNodes.get(t.id)
		for (const a of t.agents) {
			if (t.id === current && asking.some((p) => sameAgent(p, a.to))) continue
			connections.push({ ...down, from, to: row(a.to), toAt: -20, className: state(a.status) })
		}
	}
	const mine = shownThreads.find((t) => t.id === current)?.agents ?? []
	for (const p of asking)
		connections.push({
			...down,
			from: pickButton,
			to: row(p),
			toAt: -20,
			className: state(mine.find((a) => sameAgent(a.to, p))?.status) || 'route',
		})
	canvas.draw(connections)
}

onChange(render)
$('memory').setAttribute('server', url)
watchServer()
setInterval(refresh, 5000)
