/** What you write and whom it asks; drafts survive moving between threads. */
import html from '@solidjs/html'
import { createEffect, createMemo, createRoot, createSignal, createStore, For, Show } from 'solid-js'
import { api, current, openThread, runners, threads } from './server.js'
import { agentLabel, formatAgent, parseAgent, sameAgent, THINKING_LEVELS } from './agent.js'
import { Dot } from './dot.js'

const {
	draft,
	setDraft,
	picks,
	choose,
	typed,
	setTyped,
	settings,
	setSettings,
	sending,
	setSending,
} = createRoot(() => {
	const [draft, setDraft] = createSignal('')
	const [chosen, choose] = createSignal(null)
	const [typed, setTyped] = createSignal(null)
	const [settings, setSettings] = createStore({})
	const [sending, setSending] = createSignal(false)
	const picks = createMemo(() => {
		const home = runners.find((r) => r.online) ?? runners[0]
		return (
			chosen() ??
			(home?.model ? [{ runner: home.name, model: home.model, thinkingLevel: 'low' }] : [])
		)
	})
	return {
		draft,
		setDraft,
		picks,
		choose,
		typed,
		setTyped,
		settings,
		setSettings,
		sending,
		setSending,
	}
})
const pickOn = (r) => picks().find((p) => p.runner === r.name && !p.name)
const settingFor = (r) => pickOn(r) ?? settings[r.name] ?? { model: r.model, thinkingLevel: 'low' }
const select = (next) => {
	choose(next)
	setTyped(null)
}
const tune = (r, change) => {
	const next = { ...settingFor(r), ...change }
	setSettings((s) => {
		s[r.name] = next
	})
	if (pickOn(r)) select(picks().map((p) => (p === pickOn(r) ? { ...next, runner: r.name } : p)))
}
const pickRunner = (r, also, change = {}) => {
	const self = { ...settingFor(r), ...change, runner: r.name }
	const on = pickOn(r)
	setSettings((s) => { s[r.name] = self })
	select(
		!also
			? [self]
			: !on
				? [...picks(), self]
				: picks().length > 1
					? picks().filter((p) => p !== on)
					: picks(),
	)
}

export function Composer(props) {
	let input, picker, button
	const active = () => current() === props.thread
	const [expanded, setExpanded] = createSignal(false)
	const asking = () => picks().map(agentLabel).join(' + ')
	const busy = () =>
		threads
			.find((t) => t.id === current())
			?.agents.some((a) => a.status === 'working' && picks().some((p) => sameAgent(a.to, p)))
	createEffect(active, (on) => { if (on) input.focus() })
	const submit = async (e) => {
		e.preventDefault()
		if (sending() || !picks().length || !draft().trim()) return
		const body = draft(),
			to = picks(),
			was = current()
		setSending(true)
		setDraft('')
		try {
			const id = was ?? (await api('/api/threads', { title: body.slice(0, 60) })).id
			if (!was && current() === was) openThread(id)
			await api(`/api/threads/${id}/entries`, { body, to })
		} catch (error) {
			if (!draft()) setDraft(body)
			alert(error.message)
		} finally {
			setSending(false)
		}
	}
	const typeRecipients = (e) => {
		const text = e.currentTarget.value
		setTyped(text)
		const agents = threads.find((t) => t.id === current())?.agents ?? []
		const next = text.split(',').map((s) => s.trim()).filter(Boolean)
			.map((s) => agents.find((a) => a.name === s)?.to ?? parseAgent(s))
		setSettings((s) => {
			for (const { runner, name, ...setting } of next) if (!name) s[runner] = setting
		})
		choose(next)
	}
	return html`
		<form class=${() => ({ compose: active(), elsewhere: !active() })} onSubmit=${submit}>
			<div class="box">
				<input
					ref=${(el) => {
						input = el
					}}
					autocomplete="off"
					required
					enterkeyhint="send"
					aria-label="Message"
					placeholder=${() => !active() ? 'Write here' : picks().length ? `Ask ${picks().map(agentLabel).join(' and ')}` : 'Pick whom to ask, below'}
					value=${() => active() ? draft() : ''}
					onFocus=${() => {
						if (!active()) openThread(props.thread)
						if (picks().length) choose(picks())
					}}
					onInput=${(e) => setDraft(e.currentTarget.value)}
				/>
				<${Show} when=${() => active()}><button
					class="icon send"
					title="Send"
					aria-label="Send"
					disabled=${() => sending() || !picks().length}
				>
					↵
				</button><//>
			</div>
			<div class="bar">
				<button
					type="button"
					class="icon add"
					disabled
					title="Attach (not yet)"
					aria-label="Attach"
				>
					+
				</button>
				<button type="button" class="icon mic" disabled title="Voice (not yet)" aria-label="Voice">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					>
						<rect x="9" y="3" width="6" height="11" rx="3" />
						<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
					</svg>
				</button>
				<${Show}
					when=${() => active() && threads.some((t) => t.id === current() && ['working', 'blocked'].includes(t.status))}
				>
					<button
						type="button"
						class="icon"
						aria-label="Stop"
						title="Stop this thread"
						onClick=${() => api(`/api/threads/${current()}/stop`, {}).catch((e) => alert(e.message))}
					>
						Stop
					</button>
				<//>
				<button
					type="button"
					class="pick"
					aria-label="Model"
					ref=${(el) => {
						button = el
					}}
					aria-expanded=${() => String(expanded())}
					title=${() => picks().map(formatAgent).join(', ')}
					onClick=${() => { openThread(props.thread); picker.togglePopover() }}
				>
					<${Dot} state=${() => (picks().length ? (busy() ? 'working' : 'on') : '')} />
					<span>${() => asking() || 'Pick a model'}</span>
				</button>
			</div>
			<div
				class="model-picker"
				popover
				ref=${(el) => {
					picker = el
				}}
				onToggle=${(e) => {
					const open = e.newState === 'open'
					setExpanded(open)
					if (!open || matchMedia('(max-width: 700px)').matches) return
					const r = button.getBoundingClientRect()
					Object.assign(picker.style, {
						left: `${Math.max(8, Math.min(r.left, innerWidth - picker.offsetWidth - 8))}px`,
						top: 'auto',
						bottom: `${innerHeight - r.top + 6}px`,
					})
				}}
			>
				<ul>
					<${For}
						each=${() => runners.filter((r) => r.online)}
						fallback=${html`<li class="mute">No runner is online.</li>`}
					>
						${(r) => html`<${PickerRunner} runner=${() => r} onClose=${(_event) => picker.hidePopover()} />`}
					<//>
				</ul>
				<input
					class="recipients"
					aria-label="Recipients"
					autocomplete="off"
					spellcheck="false"
					title="model:thinking@runner, comma between several"
					value=${() => typed() ?? picks().map(formatAgent).join(', ')}
					onInput=${typeRecipients}
					onKeyDown=${(e) => {
						if (e.key === 'Enter') e.preventDefault()
					}}
				/>
			</div>
		</form>
	`
}

function PickerRunner(props) {
	const r = () => props.runner
	const set = () => settingFor(r())
	const models = () => [...new Set([set().model, r().model, ...(r().offers ?? [])].filter(Boolean))]
	return html`
		<li class=${() => ({ on: !!pickOn(r()) })}>
			<div class="who">
				<${Dot} state=${() => (r().busy ? 'working' : 'on')} /><b>${() => r().name}</b>
				<small title=${() => r().dir}
					>${() => (r().busy ? `busy in ${r().busy} thread${r().busy > 1 ? 's' : ''}` : r().dir)}</small
				>
				<${Show} when=${() => runners.filter((r) => r.online).length > 1}>
					<button
						type="button"
						class="also"
						aria-pressed=${() => String(!!pickOn(r()))}
						onClick=${() => pickRunner(r(), true)}
					>
						${() => (pickOn(r()) ? 'asked' : 'ask too')}
					</button>
				<//>
			</div>
			<div class="models">
				<${For} each=${() => models()}
					>${(model) => html`
						<button
							type="button"
							class=${() => ['model', { on: !!pickOn(r()) && model === set().model }]}
							onClick=${(e) => {
								if (pickOn(r()) && (e.shiftKey || picks().length > 1)) tune(r(), { model })
								else pickRunner(r(), e.shiftKey, { model })
								if (!e.shiftKey) props.onClose()
							}}
						>
							<span>${() => model.split('/').pop()}</span
							><small>${() => (model.includes('/') ? model.split('/')[0] : '')}</small>
						</button>
					`}<//
				>
			</div>
			<h4>Thinking</h4>
			<div class="steps">
				<${For} each=${() => THINKING_LEVELS}
					>${(level) => html`
						<button
							type="button"
							title=${() => level}
							aria-pressed=${() => String(set().thinkingLevel === level)}
							onClick=${() => tune(r(), { thinkingLevel: set().thinkingLevel === level ? undefined : level })}
						>
							${() => ({ minimal: 'min', medium: 'med' })[level] ?? level}
						</button>
					`}<//
				>
			</div>
			<${Show} when=${() => r().folders?.length > 1}>
				<h4>Folder</h4>
				<select
					aria-label="Folder"
					value=${() => set().dir ?? ''}
					onChange=${(e) => tune(r(), { dir: e.currentTarget.value || undefined })}
				>
					<${For} each=${() => r().folders}
						>${(folder) => html`
							<option
								value=${() => (folder === r().dir ? '' : folder.startsWith(`${r().dir}/`) ? folder.slice(r().dir.length + 1) : folder)}
							>
								${() => (folder === r().dir ? folder : folder.startsWith(`${r().dir}/`) ? folder.slice(r().dir.length + 1) : folder)}
							</option>
						`}<//
					>
				</select>
			<//>
		</li>
	`
}
