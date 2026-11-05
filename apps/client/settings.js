/** The server's settings: its modules, on or off, and memory's model. Its own machine changes them; saving restarts it. */
import html from '@solidjs/html'
import { createEffect, createRoot, createSignal, createStore, createUniqueId, For, Show, snapshot, untrack } from 'solid-js'
import { api, connected, server } from './server.js'
import { ModelPicker } from './model-picker.js'
import { Panes } from './panes.js'
import { agentLabel, agentTo, formatAgent } from './agent.js'
import { report } from './notice.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'

/** What a module does: the first sentence client.html says about it; a module of your own has none there */
const about = (name) =>
	[...document.querySelectorAll('#modules ~ dl.words > dt')]
		.find((dt) => dt.firstChild?.textContent.trim() === `${name}.js`)
		?.nextElementSibling?.textContent.replace(/\s+/g, ' ')
		.trim()
		.match(/^.*?\.(?=\s|$)/)?.[0]

/** Changes not saved yet, kept if the settings close before saving */
const [draft, setDraft] = createRoot(() => createStore({ modules: {}, model: undefined, state: '' }))
const changed = () => Object.keys(draft.modules).length > 0 || draft.model !== undefined

export function Settings() {
	let button, panel
	const id = createUniqueId()
	const [selection, setSelection] = createSignal(null)
	const all = () => [
		...server().modules.map((name) => ({ name, on: true })),
		...(server().off ?? []).map((name) => ({ name, on: false })),
	]
	const overridden = (name) => server().settings?.overrides.includes(name)
	const editable = () => server().local && draft.state === ''
	const on = (module) => draft.modules[module.name] ?? module.on
	const model = () => draft.model ?? server().settings?.memory.model ?? ''
	const toggle = (module) =>
		setDraft((store) => {
			if (!module.on === !on(module)) store.modules[module.name] = !module.on
			else delete store.modules[module.name]
		})
	const pickModel = () => setSelection(agentTo(model()))
	const back = () => setSelection(null)
	const done = () => {
		setDraft((store) => void (store.model = selection().model ? formatAgent(selection()) : ''))
		back()
	}
	const save = async () => {
		setDraft((store) => void (store.state = 'saving'))
		try {
			const { restarts } = await api('/api/settings', {
				modules: snapshot(draft.modules),
				...(draft.model !== undefined && { memory: { model: draft.model } }),
			})
			setDraft((store) => {
				store.modules = {}
				store.model = undefined
				store.state = restarts ? 'restarting' : 'stopped'
			})
		} catch (error) {
			setDraft((store) => void (store.state = ''))
			report(error)
		}
	}
	// The page reconnects on its own; once the server is back, the panel is ready for the next change
	createEffect(connected, (up) => {
		if (up && untrack(() => draft.state !== 'saving' && draft.state !== ''))
			setDraft((store) => void (store.state = ''))
	})
	return html`
		<button
			class="settings-toggle"
			type="button"
			title="Settings"
			aria-label="Settings"
			ref=${(el) => (button = el)}
			popovertarget=${id}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
				<circle cx="16" cy="7" r="2" />
				<circle cx="10" cy="17" r="2" />
			</svg>
		</button>
		<div
			class="settings"
			id=${id}
			popover
			ref=${(el) => (panel = el)}
			onToggle=${(event) => {
				if (event.newState === 'open') placePopover(panel, button)
				else back()
			}}
		>
			<${Panes}
				title="Modules"
				detailTitle="Memory’s agent"
				open=${() => selection() !== null}
				onBack=${(event) => back()}
				actions=${html`<button type="button" onClick=${done}>Done</button>`}
				detail=${html`
					<div class="memory-model">
						<p><b>Memory’s model</b><br />
							Writes and merges memory’s lines. Choose a cheaper model here without changing the thread’s agent.
						</p>
						<div class="model-controls">
							<button type="button"
								class=${() => ['model', { on: !selection()?.model }]}
								aria-pressed=${() => String(!selection()?.model)}
								onClick=${() => setSelection(agentTo(''))}
							>Use each thread’s agent</button>
						</div>
					</div>
					<${ModelPicker}
					getTo=${(runner) => selection()?.runner === runner.name
						? selection()
						: { runner: runner.name, model: runner.model }}
					selectedRunner=${() => selection()?.runner}
					onChoose=${(to) => setSelection(to)}
					onConfigure=${(to) => setSelection(to)}
				/>`}
			>
			<ul class="modules">
				<${For} each=${all}
					>${(module) => html`
						<li class=${() => ({ off: !on(module) })}>
							<${Dot} state=${() => (module.on ? 'on' : '')} />
							<div>
								<b>${() => module.name}</b>
								<small>${() => about(module.name) ?? 'Your own module.'}</small>
								<${Show} when=${() => module.name === 'memory' && on(module)}>
									<div class="option">
										<span>Writes its lines</span>
										<button
											type="button"
											disabled=${() => !editable() || overridden('MEMORY_MODEL')}
											title=${() => model() || "Each thread's own agent writes its lines"}
											onClick=${pickModel}
										>
											${() => (model() ? agentLabel(agentTo(model())) : "the thread's agent")}
										</button>
										<${Show} when=${() => model() && editable() && !overridden('MEMORY_MODEL')}>
											<button
												type="button"
												title="Each thread's own agent writes its lines"
												onClick=${() => setDraft((store) => void (store.model = ''))}
											>
												×
											</button>
										<//>
									</div>
								<//>
							</div>
							<input
								type="checkbox"
								role="switch"
								aria-label=${() => `${module.name} on`}
								checked=${() => on(module)}
								disabled=${() => !editable() || overridden('MODULES')}
								onChange=${() => toggle(module)}
							/>
						</li>
					`}<//
				>
			</ul>
			<${Show}
				when=${() => server().local}
				fallback=${html`<p class="mute">Change these on the server's own machine.</p>`}
			>
				<${Show} when=${() => overridden('MODULES')}>
					<p class="mute">Module switches are locked by MODULES in the server’s environment.</p>
				<//>
				<${Show} when=${() => overridden('MEMORY_MODEL')}>
					<p class="mute">Memory’s agent is locked by MEMORY_MODEL in the server’s environment.</p>
				<//>
				<${Show}
					when=${() => draft.state === ''}
					fallback=${html`<p class="mute" role="status">
						${() =>
							draft.state === 'saving'
								? 'Saving…'
								: draft.state === 'restarting'
									? 'Saved. The server is restarting; this page reconnects on its own.'
									: 'Saved, and the server stopped: it can’t restart itself here. Start it again with node server.js.'}
					</p>`}
				>
					<button type="button" class="save" disabled=${() => !changed()} onClick=${save}>
						Save and restart
					</button>
				<//>
			<//>
			<//>
		</div>
	`
}
