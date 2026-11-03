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
} from 'solid-js'
import { api, connected, current, server } from './server.js'

const bytes = (text) => new TextEncoder().encode(text).length
const sizeOf = (lines) => lines.reduce((sum, x) => sum + bytes(`${x.id}+${x.n}|${x.text}`) + 1, 0)
const inside = (x, id, n) => x.id >= id && x.id + x.n <= id + n
const key = (x) => `${x.id}+${x.n}`

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
							This server runs without memory. Start it with
							<code>MODULES=+memory MEMORY_MODEL=model@runner</code>.
						</p>
					`}
				>
					<${For} each=${() => (current() ? [current()] : [])}>
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
	const lines = createProjection(
		() => api(`/api/threads/${props.thread}/memory`).then((r) => r.lines),
		[],
		{ key: 'id' },
	)
	const bounds = createMemo(async () => {
		const total = lines.length ? lines.at(-1).id + lines.at(-1).n : 0
		const full = sizeOf(lines)
		const top = total ? await api(`/api/threads/${props.thread}/memory?budget=1`) : { lines: [] }
		const least = Math.max(100, sizeOf(top.lines))
		return { total, least, full: Math.max(least * 2, full) }
	})
	const tree = createMemo(async () => {
		const { total, least, full } = bounds()
		const budget = Math.round(least * (full / least) ** (props.room / 100))
		const path = `/api/threads/${props.thread}/memory`
		if (!total) return { total, budget, cut: [], nodes: [] }
		const { lines: cut } = await api(`${path}?budget=${budget}`)
		const nodes =
			cut.length === 1 && cut[0].n >= total
				? [{ ...cut[0], kind: 'cut' }]
				: await openTree(path, 0, 2 ** Math.ceil(Math.log2(total)), cut)
		return { total, budget, cut, nodes }
	})
	onSettled(() => {
		const timer = setInterval(() => refresh(lines), 3000)
		return () => clearInterval(timer)
	})
	let root
	return html`
		<div
			class="memory reads"
			ref=${(el) => {
				root = el
			}}
		>
			<${Show}
				when=${() => tree().total}
				fallback=${html`<p class="mute">No messages yet.</p>`}
			>
				<label class="room"
					>Room
					<input
						type="range"
						min="0"
						max="100"
						aria-label="Memory room"
						value=${() => props.room}
						onInput=${(e) => props.onRoom(Number(e.currentTarget.value))}
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
					<${For}
						each=${() => tree().cut}
						keyed=${key}
					>
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
				<${Lines}
					nodes=${() => tree().nodes}
					thread=${() => props.thread}
					total=${() => tree().total}
				/>
			<//>
		</div>
	`
}

/** The same cut an agent reads, opened from the top down. All reads use the captured thread. */
async function openTree(path, id, n, cut) {
	const halves = n > 1 ? (await api(`${path}?zoom=${id},${n}`)).lines : null
	if (!halves?.length)
		return cut.filter((x) => inside(x, id, n)).map((x) => ({ ...x, kind: 'cut' }))
	if (halves.length === 1 && !cut.some((x) => key(x) === key(halves[0])))
		return openTree(path, halves[0].id, halves[0].n, cut)
	return Promise.all(
		halves.map(async (h) => {
			const mine = cut.filter((x) => inside(x, h.id, h.n))
			return mine.some((x) => key(x) === key(h))
				? { ...h, kind: 'cut' }
				: { ...h, kind: 'above', children: await openTree(path, h.id, h.n, mine) }
		}),
	)
}
const Lines = (props) => html`
	<ul>
		<${For}
			each=${() => props.nodes}
			keyed=${key}
		>
			${(line) => html`
				<${Line}
					line=${() => line()}
					thread=${() => props.thread}
					total=${() => props.total}
				/>
			`}
		<//>
	</ul>
`
function Line(props) {
	const [expanded, setExpanded] = createSignal(false)
	const waiting = () => props.line.text.startsWith('(not summarized')
	const opened = createMemo(() =>
		expanded()
			? api(`/api/threads/${props.thread}/memory?zoom=${props.line.id},${props.line.n}`)
			: null,
	)
	return html`
		<li
			data-at=${() => key(props.line)}
			class=${() => [props.line.kind, { pending: waiting() }]}
			title=${() =>
				props.line.n > 1
					? `messages ${props.line.id} to ${props.line.id + props.line.n - 1}`
					: `message ${props.line.id}`}
			onClick=${(e) => {
				e.stopPropagation()
				if (props.line.kind !== 'above') setExpanded((on) => !on)
			}}
		>
			<small>${() => key(props.line)}</small>
			<span
				>${() =>
					!waiting()
						? props.line.text
						: props.line.id + props.line.n > props.total
							? `the last ${props.total - props.line.id} messages, waiting for more before they merge`
							: 'being written, from the messages up'}</span
			>
			<${Show} when=${() => props.line.children}>
				<${Lines}
					nodes=${() => props.line.children}
					thread=${() => props.thread}
					total=${() => props.total}
				/>
			<//>
			<${Show} when=${() => expanded() && props.line.kind !== 'above'}>
				<${Loading} fallback=${html`<span class="opening">Opening…</span>`}>
					<${Show}
						when=${() => opened()?.message !== undefined}
						fallback=${() => html`
							<${Lines}
								nodes=${() => (opened()?.lines ?? []).map((x) => ({ ...x, kind: 'below' }))}
								thread=${() => props.thread}
								total=${() => props.total}
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
