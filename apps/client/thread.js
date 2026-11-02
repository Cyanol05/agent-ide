/** A thread on screen, its entries, and the ways the page points at one */
import { h, dotClass, drawer } from './dom.js'
import { authorLabel, lastToolCall, messageText } from './agent.js'
import {
	changed,
	colorOf,
	current,
	deleteThread,
	doing,
	entries,
	fork,
	forkedFrom,
	homeBot,
	me,
	newThreadTools,
	openThread,
	params,
	threads,
	titleOf,
} from './state.js'
import { form, openPicker, pickButton } from './composer.js'

/** A thread's name opens its details in the chat, and writes in it on the page with the story */
const onTitle = (id) => () =>
	current !== id
		? openThread(id)
		: document.body.classList.contains('chat')
			? drawer('side')
			: form.querySelector('input').focus()

/** One node per thread on screen, kept: taking one out and back would lose the cursor in it */
export const threadNodes = new Map()
const opened = new Set() // `${thread} ${entry}` of the answers opened to read in full
export function Thread(id) {
	const t = threads.find((x) => x.id === id)
	let node = threadNodes.get(id)
	if (!node) {
		/** A thread that isn't current shows a box to write in all the same */
		const write = h(
			'form',
			{ className: 'elsewhere' },
			h(
				'div',
				{ className: 'box' },
				h('input', { placeholder: 'Write here', onfocus: () => openThread(id) }),
			),
			h(
				'div',
				{ className: 'bar' },
				...[...form.querySelector('.bar').children]
					.filter((c) => c.id !== 'to')
					.map((c) => c.cloneNode(true)),
			),
		)
		write.querySelector('.pick').onclick = () => {
			openThread(id)
			changed()
			openPicker()
		}
		node = h(
			'article',
			{ className: 'thread' },
			h('header', { onclick: onTitle(id) }, h('span'), h('span', { className: 'dot' })),
			h('nav', { className: 'from' }),
			h('ul'),
			write,
		)
		threadNodes.set(id, node)
	}
	node.classList.toggle('current', id === current)
	node.classList.toggle('hands-off', Boolean(t?.tools))
	const [title, dot] = node.querySelector('header').children
	title.textContent = t?.title || 'untitled'
	dot.className = dotClass(t?.status)
	/** A fork says where it came from up top */
	const origin = forkedFrom(t)
	const from = node.querySelector('nav.from')
	const fromSig = JSON.stringify([origin, titleOf(origin)])
	if (from.dataset.sig !== fromSig) {
		from.dataset.sig = fromSig
		from.replaceChildren(
			...(origin ? [ThreadLink(origin, `← forked from ${titleOf(origin)}`)] : []),
		)
	}
	node.querySelector('form.elsewhere').hidden = id === current
	node
		.querySelector('form.elsewhere .pick')
		.replaceChildren(...pickButton.cloneNode(true).childNodes)
	/** Messages, then any reply still being written */
	const list = node.querySelector('ul')
	const writing = (t?.agents ?? [])
		.map((a) => {
			const now = doing.get(`${id} ${a.name}`)
			return [a.name, messageText(now?.message), lastToolCall(now)]
		})
		.filter(([, s, call]) => s || call)
	const messages = (entries.get(id) ?? []).filter((x) => x.kind === 'agent-ide.message')
	/** Forks made from a message, as links under it */
	const forksAt = new Map()
	for (const f of threads)
		if (forkedFrom(f) === id && !f.hidden)
			forksAt.set(f.conversation.parent.at, [...(forksAt.get(f.conversation.parent.at) ?? []), f])
	const sig = JSON.stringify([
		homeBot(id)?.instructions === '',
		messages.map((x) => x.id),
		writing,
		[...forksAt].map(([at, fs]) => [at, fs.map((f) => [f.id, f.title, f.status])]),
	])
	if (list.dataset.sig !== sig) {
		list.dataset.sig = sig
		const grew = messages.length + writing.length > list.children.length
		const stuck = grew || list.scrollTop + list.clientHeight >= list.scrollHeight - 4
		const newBot = homeBot(id)?.instructions === '' && homeBot(id)
		list.replaceChildren(
			...(newBot
				? [
						h('li', {
							className: 'mute',
							textContent: `${newBot.name} has no instructions yet. Talk to ${newBot.name} and find out who it is.`,
						}),
					]
				: []),
			...messages.map((m, i) => Message(id, m, messages[i - 1], forksAt.get(m.id) ?? [])),
			...writing.map(([name, s, call]) => Writing(name, s, call)),
		)
		if (stuck) list.scrollTop = list.scrollHeight
	}
	if (id === current && form.parentNode !== node) node.append(form)
	return node
}

/** One message */
function Message(id, { id: at, data }, previous, forks) {
	const elsewhere = data.from && data.from !== id
	return h(
		'li',
		{
			className: elsewhere
				? `elsewhere${data.re ? ' reply' : ''}`
				: data.author === me
					? 'mine'
					: !previous?.data.from && previous?.data.author === data.author
						? 'same'
						: '',
		},
		...(elsewhere && data.re
			? // An answer to a post is the post's result: one line, like a tool call, opened on click.
				[
					h(
						'details',
						{
							open: opened.has(`${id} ${at}`),
							ontoggle: (e) => opened[e.target.open ? 'add' : 'delete'](`${id} ${at}`),
						},
						h(
							'summary',
							{},
							...(homeBot(data.from)?.name === data.author
								? [
										Object.assign(ThreadLink(data.from, authorLabel(data.author)), {
											style: colorOf(data.author),
										}),
										' answered',
									]
								: [
										h('span', { style: colorOf(data.author) }, authorLabel(data.author)),
										' answered in ',
										ThreadLink(data.from, titleOf(data.from)),
									]),
						),
						h('span', { className: 'body' }, data.body),
					),
				]
			: [
					elsewhere &&
						h(
							'div',
							{ className: 'links' },
							ThreadLink(data.from, `→ asked from ${titleOf(data.from)}`),
						),
					h('small', { title: data.author, style: colorOf(data.author) }, authorLabel(data.author)),
					h('span', { className: 'body' }, data.body),
				]),
		...forks.map((f) => h('div', { className: 'links' }, ThreadLink(f.id, `forked → ${f.title}`))),
		h('button', {
			className: 'fork',
			textContent: 'fork',
			title: 'A new thread from this message',
			onclick: () => fork(id, at),
		}),
	)
}
/** A reply still being written, and the tool it's calling */
const Writing = (name, text, call) =>
	h(
		'li',
		{ className: 'writing' },
		h('small', { textContent: `${authorLabel(name)} · ${call || 'writing'}`, title: call }),
		text,
	)

/** Where a new thread starts */
let newThread
export function NewThread() {
	newThread ??= h(
		'article',
		{ className: 'thread current' },
		h('header', { onclick: onTitle(null) }, h('span', { textContent: 'a new thread' })),
	)
	newThread.classList.toggle('hands-off', Boolean(newThreadTools))
	if (form.parentNode !== newThread) newThread.append(form)
	return newThread
}

/** A thread as a row, the same in the list of all threads and in a thread's family */
export const ThreadItem = (t, depth = 0) =>
	h(
		'li',
		{
			className: t.id === current ? 'current' : '',
			title: t.title,
			style: `--depth: ${depth}`,
			onclick: () => openThread(t.id),
		},
		h('span', { className: dotClass(t.status) }),
		h('span', { textContent: t.title || 'untitled' }),
		!homeBot(t.id) &&
			h('button', {
				textContent: 'delete',
				title: 'Delete this thread',
				onclick: (e) => {
					e.stopPropagation()
					deleteThread(t.id)
				},
			}),
	)

/** A link to another thread; its dot lives in its own header and the list */
export const ThreadLink = (id, label) =>
	h(
		'a',
		{
			href: `?${new URLSearchParams({ ...Object.fromEntries(params), thread: id })}`,
			className: 'thread-link',
			onclick: (e) => {
				e.preventDefault()
				openThread(id)
			},
		},
		label,
	)

/** A thread's tools, as `pi --tools` takes them */
export const HANDS_OFF = ['-write', '-edit', '-bash']
const parseTools = (text) => text.split(/[\s,]+/).filter(Boolean)
export function Tools(tools, set) {
	const toggle = h('button', {
		type: 'button',
		textContent: 'hands off',
		title: 'Its agents read and ask others, and change nothing themselves',
	})
	const field = h('input', {
		placeholder: 'every tool',
		spellcheck: false,
		title: 'tools, as pi --tools takes them: read,post or -write,-edit,-bash',
	})
	const show = (list) => {
		toggle.setAttribute('aria-pressed', Boolean(list))
		if (document.activeElement !== field) field.value = (list ?? []).join(',')
	}
	const apply = async (list) => {
		field.classList.remove('bad')
		try {
			await set(list?.length ? list : null)
		} catch (error) {
			field.classList.add('bad')
			field.title = error.message
		}
	}
	toggle.onclick = (e) => {
		e.stopPropagation()
		apply(toggle.getAttribute('aria-pressed') === 'true' ? null : HANDS_OFF)
	}
	field.onchange = () => apply(parseTools(field.value))
	field.onkeydown = (e) => {
		if (e.key === 'Enter') field.blur()
	}
	const node = h('div', { className: 'hands' }, toggle, field)
	node.show = show
	show(tools)
	return node
}
