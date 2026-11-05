/** The server's settings, so far its modules: which are on, which off, and where you change them. */
import html from '@solidjs/html'
import { For } from 'solid-js'
import { server } from './server.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'

/** What a module does: the first sentence client.html says about it; a module of your own has none there */
const about = (name) =>
	[...document.querySelectorAll('#modules ~ dl.words > dt')]
		.find((dt) => dt.firstChild?.textContent.trim() === `${name}.js`)
		?.nextElementSibling?.textContent.replace(/\s+/g, ' ')
		.trim()
		.match(/^.*?\.(?=\s|$)/)?.[0]

export function Settings() {
	let button, panel
	const all = () => [
		...server().modules.map((name) => ({ name, on: true })),
		...(server().off ?? []).map((name) => ({ name, on: false })),
	]
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
			onToggle=${(e) => {
				if (e.newState === 'open') placePopover(panel, button)
			}}
		>
			<h3>Modules</h3>
			<ul>
				<${For} each=${all}
					>${(m) => html`
						<li class=${() => ({ off: !m.on })}>
							<${Dot} state=${() => (m.on ? 'on' : '')} />
							<div>
								<b>${() => m.name}</b>
								<small>${() => about(m.name) ?? 'Your own module.'}</small>
							</div>
							<span class="state">${() => (m.on ? 'on' : 'off')}</span>
						</li>
					`}<//
				>
			</ul>
			<p class="mute">
				Pick them in <code>agent-ide.json</code> or with <code>MODULES=+search,-talk</code>, then
				restart the server.
			</p>
		</div>
	`
}
