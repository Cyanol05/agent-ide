/** The server's settings: its modules, on or off, and memory's model. Its own machine changes them; saving restarts it. */
import html from '@solidjs/html'
import { createEffect, createRoot, createStore, For, Show, snapshot } from 'solid-js'
import { api, connected, server } from './server.js'
import { openPicker } from './composer.js'
import { agentLabel, agentTo } from './agent.js'
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

/** Changes not saved yet, kept while the panel closes for the model picker */
const [draft, setDraft] = createRoot(() => createStore({ modules: {}, model: undefined, state: '' }))
const changed = () => Object.keys(draft.modules).length > 0 || draft.model !== undefined

export function Settings() {
	let button, panel, modelButton
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
	const pickModel = () =>
		openPicker(modelButton, (to) => {
			setDraft((store) => void (store.model = `${to.model}@${to.runner}`))
			panel.showPopover()
		})
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
		if (up && draft.state !== 'saving' && draft.state !== '') setDraft((store) => void (store.state = ''))
	})
	return html`
		<button
			class="settings-toggle"
			type="button"
			title="Settings"
			aria-label="Settings"
			ref=${(el) => (button = el)}
			onClick=${() => panel.togglePopover()}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
				<circle cx="16" cy="7" r="2" />
				<circle cx="10" cy="17" r="2" />
			</svg>
		</button>
		<div
			class="settings"
			popover
			ref=${(el) => (panel = el)}
			onToggle=${(event) => {
				if (event.newState === 'open') placePopover(panel, button)
			}}
		>
			<h3>Modules</h3>
			<ul>
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
											ref=${(el) => (modelButton = el)}
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
				<${Show} when=${() => server().settings?.overrides.length}>
					<p class="mute">
						${() => server().settings.overrides.join(' and ')} in the environment
						${() => (server().settings.overrides.length > 1 ? 'override' : 'overrides')} what you pick here.
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
		</div>
	`
}
