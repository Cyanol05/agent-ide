/** One dot everywhere: on, working or blocked */
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
