/** One dot everywhere: on, working or blocked; and a switch, a row whose dot says on or off */
import html from '@solidjs/html'

export const Dot = (props) => html`
	<span
		title=${() => props.title}
		class=${() => [
			'dot',
			{
				on: props.state === 'on',
				working: props.state === 'working',
				blocked: props.state === 'blocked',
			},
		]}
	></span>
`

export const Switch = (props) => html`
	<button
		type="button"
		class="row switch"
		role="switch"
		aria-checked=${() => String(!!props.on)}
		disabled=${() => props.disabled}
		title=${() => props.title}
		onClick=${(event) => props.onToggle(!props.on, event)}
	>
		<${Dot} state=${() => (props.on ? 'on' : '')} />
		${() => props.children}
	</button>
`
