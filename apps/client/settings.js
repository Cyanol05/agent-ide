/** The server's settings: its modules, on or off, and memory's model. Its own machine changes them; saving restarts it. */
import html from '@solidjs/html'
import {
	createEffect,
	createRoot,
	createSignal,
	createStore,
	createUniqueId,
	For,
	Show,
	snapshot,
	untrack,
} from 'solid-js'
import { api, connected, server } from './server.js'
import { ModelPicker } from './model-picker.js'
import { Panes } from './panes.js'
import { agentTo, formatAgent, writtenTo } from './agent.js'
import { report } from './notice.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'

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
	const compactAt = () => draft.compactAt ?? server().settings?.memory.compactAt ?? 100000
	const memoryThreads = () => draft.threads ?? server().settings?.memory.threads ?? 'bots'
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
				...((draft.model !== undefined ||
					draft.compactAt !== undefined ||
					draft.threads !== undefined) && {
					memory: {
						...(draft.model !== undefined && { model: draft.model }),
						...(draft.compactAt !== undefined && { compactAt: draft.compactAt }),
						...(draft.threads !== undefined && { threads: draft.threads }),
					},
				}),
			})
			setDraft((store) => {
				store.modules = {}
				store.model = undefined
				store.compactAt = undefined
				store.threads = undefined
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
			class="ghost foot-toggle settings-toggle"
			type="button"
			ref=${(el) => (button = el)}
			popovertarget=${id}
		>
			Settings
		</button>
		<div
			class="popover"
			id=${id}
			popover
			ref=${(el) => (panel = el)}
			onToggle=${(event) => {
				if (event.newState === 'open') placePopover(panel, button)
				else back()
			}}
		>
			<${Panes}
				title="Settings"
				detailTitle="Memory’s agent"
				open=${() => selection() !== null}
				close=${html`<button
					type="button"
					class="ghost close icon"
					aria-label="Close"
					onClick=${() => panel.hidePopover()}
				>
					×
				</button>`}
				onBack=${(event) => back()}
				actions=${html`<button type="button" class="small" onClick=${done}>Done</button>`}
				detail=${html` <div class="memory-model">
						<p>
							<b>Memory’s model</b><br />
							Writes and merges memory’s lines. Choose a cheaper model here without changing the
							thread’s agent.
						</p>
						<div class="model-controls">
							<button
								type="button"
								class=${() => ['model', { on: !selection()?.model }]}
								aria-pressed=${() => String(!selection()?.model)}
								onClick=${() => setSelection(agentTo(''))}
							>
								Use each thread’s agent
							</button>
						</div>
					</div>
					<${ModelPicker}
						getTo=${(runner) =>
							selection()?.runner === runner.name
								? selection()
								: { runner: runner.name, model: runner.model }}
						selectedRunner=${() => selection()?.runner}
						onChoose=${(to) => setSelection(to)}
						onConfigure=${(to) => setSelection(to)}
					/>`}
			>
				<ul class="rows">
					<${For} each=${all}
						>${(module) => html`
							<li class=${() => ({ off: !on(module) })}>
								<${Dot} state=${() => (module.on ? 'on' : '')} />
								<div>
									<b>${() => module.name}</b>
									<small>${() => server().about?.[module.name] ?? 'Your own module.'}</small>
									<${Show} when=${() => module.name === 'memory' && on(module)}>
										<div class="option">
											<span>Writes its lines</span>
											<button
												type="button"
												class="small"
												disabled=${() => !editable() || overridden('MEMORY_MODEL')}
												title=${() => model() || "Each thread's own agent writes its lines"}
												onClick=${pickModel}
											>
												${() => (model() ? writtenTo(agentTo(model())) : "the thread's agent")}
											</button>
											<${Show} when=${() => model() && editable() && !overridden('MEMORY_MODEL')}>
												<button
													type="button"
													class="small"
													title="Each thread's own agent writes its lines"
													onClick=${() => setDraft((store) => void (store.model = ''))}
												>
													Use each thread's agent
												</button>
											<//>
										</div>
										<div class="option">
											<span>Remembers</span>
											<select
												class="small"
												aria-label="Which threads remember"
												title="A thread’s own Memory switch, in its details, overrides this"
												disabled=${() => !editable() || overridden('MEMORY_THREADS')}
												value=${memoryThreads}
												onChange=${(event) => {
													const value = event.currentTarget.value
													setDraft((store) => void (store.threads = value))
												}}
											>
												<option value="bots">threads with a bot</option>
												<option value="all">every thread</option>
												<option value="none">no thread</option>
											</select>
										</div>
										<div class="option compact-option">
											<span>Compacts past</span>
											<input
												type="number"
												class="small"
												min="10"
												step="10"
												aria-label="Compacts past, in thousands of tokens"
												disabled=${() => !editable()}
												value=${() => Math.round(compactAt() / 1000)}
												onChange=${(event) => {
													const thousands = Number(event.currentTarget.value)
													if (thousands > 0)
														setDraft((store) => void (store.compactAt = thousands * 1000))
												}}
											/>
											<span>k tokens</span>
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
					<${Show} when=${() => overridden('MEMORY_THREADS')}>
						<p class="mute">
							Which threads remember is locked by MEMORY_THREADS in the server’s environment.
						</p>
					<//>
					<${Show} when=${() => overridden('MEMORY_MODEL')}>
						<p class="mute">
							Memory’s agent is locked by MEMORY_MODEL in the server’s environment.
						</p>
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

/** Changes not saved yet, kept if the settings close before saving */
const [draft, setDraft] = createRoot(() =>
	createStore({
		modules: {},
		model: undefined,
		compactAt: undefined,
		threads: undefined,
		state: '',
	}),
)
const changed = () =>
	Object.keys(draft.modules).length > 0 ||
	draft.model !== undefined ||
	draft.compactAt !== undefined ||
	draft.threads !== undefined
