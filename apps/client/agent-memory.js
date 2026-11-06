/** Memory belongs to one visible thread. Disposing it discards every outstanding read. */
import html from '@solidjs/html'
import {
	createMemo,
	createProjection,
	createSignal,
	For,
	Errored,
	Loading,
	onSettled,
	refresh,
	Show,
	untrack,
} from 'solid-js'
import { api, connected, current, server, threads } from './server.js'
import { conversations } from './run.js'

const bytes = (text) => new TextEncoder().encode(text).length
const sizeOf = (lines) => lines.reduce((sum, line) => sum + bytes(`${line.id}+${line.n}|${line.text}`) + 1, 0)
const inside = (line, id, n) => line.id >= id && line.id + line.n <= id + n
const key = (line) => `${line.id}+${line.n}`

/** What compaction did to this thread's agent: where its newest cut fell, from the agent's own conversation */
export function Compaction() {
	return html`
		<${Show} when=${() => current()} keyed>
			${(thread) => html`
				<${Loading} fallback=${html`<p class="mute">Reading the agent…</p>`}>
					<${CompactionOf} thread=${thread} />
				<//>
			`}
		<//>
	`
}

function CompactionOf(props) {
	/** Where the newest cut fell: the end of the lines its summary holds, 0 for Pi's own summary, null before any */
	const cut = () => {
		const row = threads.find((thread) => thread.id === props.thread)
		let found = null
		for (const { conversation } of row?.agents ?? [])
			for (const entry of (conversations[conversation] ?? []).filter((entry) => entry.kind === 'pi.compaction')) {
				const ends = [...JSON.stringify(entry).matchAll(/(\d+)\+(\d+)\|/g)].map(
					(line) => Number(line[1]) + Number(line[2]),
				)
				found = ends.length ? Math.max(...ends) : (found ?? 0)
			}
		return found
	}
	return html`
		<p class="mute">
			${() =>
				cut() === null
					? 'Not compacted yet.'
					: cut() === 0
						? "Compacted with Pi's summary."
						: `Messages 0 to ${cut() - 1} are read as memory lines.`}
		</p>
	`
}

export function Memory() {
	const [room, setRoom] = createSignal(30)
	return html`
		<${Errored}
			fallback=${(error, retry) => html`
				<p class="mute">${() => error().message} <button onClick=${retry}>Retry memory</button></p>
			`}
		>
			<${Show}
				when=${() => connected()}
				fallback=${html`<p class="mute">Disconnected from the server.</p>`}
			>
				<${Show}
					when=${() => server().modules.includes('memory')}
					fallback=${html`
						<p class="mute">
							This server runs without memory. Switch it on in settings with the runners.
						</p>
					`}
				>
					<${Show} when=${() => current()} keyed>
						${(id) => html`
							<${Loading} fallback=${html`<p class="mute">Reading memory…</p>`}>
								<${ThreadMemory}
									thread=${id}
									room=${() => room()}
									onRoom=${(value) => setRoom(value)}
								/>
							<//>
						`}
					<//>
				<//>
			<//>
		<//>
	`
}

function ThreadMemory(props) {
	// The keyed owner fixes the thread until this entire view is disposed.
	const path = untrack(() => `/api/threads/${props.thread}/memory`)
	const read = (query = '') => api(path + query)
	const lines = createProjection(() => read().then((memory) => memory.lines), [], { key: 'id' })
	const bounds = createMemo(async () => {
		const total = lines.length ? lines.at(-1).id + lines.at(-1).n : 0
		const full = sizeOf(lines)
		const top = total ? await read('?budget=1') : { lines: [] }
		const least = Math.max(100, sizeOf(top.lines))
		return { total, least, full: Math.max(least * 2, full) }
	})
	const tree = createMemo(async () => {
		const { total, least, full } = bounds()
		const budget = Math.round(least * (full / least) ** (props.room / 100))
		if (!total) return { total, budget, cut: [], nodes: [] }
		const { lines: cut } = await read(`?budget=${budget}`)
		const nodes =
			cut.length === 1 && cut[0].n >= total
				? [{ ...cut[0], kind: 'cut' }]
				: await openTree(read, 0, 2 ** Math.ceil(Math.log2(total)), cut)
		return { total, budget, cut, nodes }
	})
	onSettled(() => {
		const timer = setInterval(() => refresh(lines), 3000)
		return () => clearInterval(timer)
	})
	const Lines = (props) => html`
		<ul>
			<${For} each=${() => props.nodes} keyed=${key}>
				${(line) => html` <${Line} line=${() => line()} /> `}
			<//>
		</ul>
	`
	function Line(props) {
		const [expanded, setExpanded] = createSignal(false)
		const waiting = () => props.line.text.startsWith('(not summarized')
		const opened = createMemo(() =>
			expanded() ? read(`?zoom=${props.line.id},${props.line.n}`) : null,
		)
		return html`
			<li
				data-at=${() => key(props.line)}
				class=${() => [props.line.kind, { pending: waiting() }]}
				title=${() =>
					props.line.n > 1
						? `messages ${props.line.id} to ${props.line.id + props.line.n - 1}`
						: `message ${props.line.id}`}
				onClick=${(event) => {
					event.stopPropagation()
					if (props.line.kind !== 'above') setExpanded((on) => !on)
				}}
			>
				<small>${() => key(props.line)}</small>
				<span
					>${() =>
						!waiting()
							? props.line.text
							: props.line.id + props.line.n > tree().total
								? `the last ${tree().total - props.line.id} messages, waiting for more before they merge`
								: 'being written, from the messages up'}</span
				>
				<${Show} when=${() => props.line.children}>
					<${Lines} nodes=${() => props.line.children} />
				<//>
				<${Show} when=${() => expanded() && props.line.kind !== 'above'}>
					<${Loading} fallback=${html`<span class="opening">Opening…</span>`}>
						<${Show}
							when=${() => opened()?.message !== undefined}
							fallback=${() => html`
								<${Lines}
									nodes=${() => (opened()?.lines ?? []).map((line) => ({ ...line, kind: 'below' }))}
								/>
							`}
						>
							<div class="whole">${() => opened()?.message}</div>
						<//>
					<//>
				<//>
			</li>
		`
	}

	let root
	return html`
		<div class="memory reads" ref=${(el) => (root = el)}>
			<${Show} when=${() => tree().total} fallback=${html`<p class="mute">No messages yet.</p>`}>
				<label class="room"
					>Room
					<input
						type="range"
						min="0"
						max="100"
						aria-label="Memory room"
						value=${() => props.room}
						onInput=${(event) => props.onRoom(Number(event.currentTarget.value))}
					/>
					<span
						>${() => {
							const { budget } = tree()
							return budget < 1024
								? `${budget} B`
								: `${(budget / 1024).toFixed(budget < 10240 ? 1 : 0)} KB`
						}}</span
					>
				</label>
				<div class="bar">
					<${For} each=${() => tree().cut} keyed=${key}>
						${(line) => html`
							<span
								title=${() =>
									`${key(line())}: ` +
									(line().n > 1 ? `${line().n} messages in one line` : 'one message')}
								style=${() => {
									const n = line().n
									const shade = 88 - Math.min(1, Math.log2(n) / 5) * 50
									return `flex-grow:${n};background:hsl(215 60% ${shade}%)`
								}}
								onClick=${() => root.querySelector(`[data-at="${key(line())}"]`)?.click()}
							></span>
						`}
					<//>
				</div>
				<p class="mute">
					${() => {
						const { cut, budget, total } = tree(),
							n = cut.length
						return (
							`The agent reads the ${n} highlighted line${n === 1 ? '' : 's'}: ` +
							`${sizeOf(cut).toLocaleString()} of ${budget.toLocaleString()} bytes ` +
							`for ${total} messages. ` +
							(n === total
								? "Room for every message's own line."
								: n <= 2
									? 'As squeezed as it gets: it zooms to read more.'
									: 'Old messages share lines; the latest have one each.')
						)
					}}
				</p>
				<${Lines} nodes=${() => tree().nodes} />
			<//>
		</div>
	`
}

/** The same cut an agent reads, opened from the top down. All reads use the captured thread. */
async function openTree(read, id, n, cut) {
	const halves = n > 1 ? (await read(`?zoom=${id},${n}`)).lines : null
	if (!halves?.length)
		return cut.filter((line) => inside(line, id, n)).map((line) => ({ ...line, kind: 'cut' }))
	if (halves.length === 1 && !cut.some((line) => key(line) === key(halves[0])))
		return openTree(read, halves[0].id, halves[0].n, cut)
	return Promise.all(
		halves.map(async (half) => {
			const mine = cut.filter((line) => inside(line, half.id, half.n))
			return mine.some((line) => key(line) === key(half))
				? { ...half, kind: 'cut' }
				: { ...half, kind: 'above', children: await openTree(read, half.id, half.n, mine) }
		}),
	)
}
