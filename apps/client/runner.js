/** Runners show their agents and choose whom the composer asks. */
import html from '@solidjs/html'
import { For, Show } from 'solid-js'
import { runnerCommand, runners, threads } from './server.js'
import { agentKey, busiest, doing, lastToolCall, THINKING_LEVELS } from './agent.js'
import { choiceFor, choose, configure, recipients } from './composer.js'
import { placePopover } from './popover.js'
import { Dot } from './dot.js'

export function Runner(props) {
	const runner = () => props.runner
	const choice = () => choiceFor(runner())
	const agents = () => props.agents.filter((a) => a.to.runner === runner().name)
	const models = () => [
		...new Set([choice().model, runner().model, ...(runner().offers ?? [])].filter(Boolean)),
	]
	const others = () =>
		[...new Map(agents().map((a) => [agentKey(a.to), a.to])).values()].filter(
			(to) => agentKey(to) !== agentKey(choice()),
		)
	const stop = (e) => e.stopPropagation()
	const pick = (e) => choose(choice(), e.shiftKey || e.metaKey || e.ctrlKey)
	return html`
		<div
			class=${() => [
				'node',
				'card',
				{
					off: !runner().online,
					routed: recipients().some((p) => p.runner === runner().name),
				},
			]}
			data-runner=${() => runner().name}
			role="button"
			tabindex="0"
			aria-label=${() => runner().name}
			title="Click to ask it; shift-click to ask it too"
			onClick=${pick}
			onKeyDown=${(e) => {
				if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
					e.preventDefault()
					pick(e)
				}
			}}
		>
			<b
				><${Dot}
					state=${() => (runner().online ? busiest(agents()) || 'on' : '')}
				/>${() => runner().name}</b
			>
			<small>${() => runner().dir}</small>
			<${Show} when=${() => !models().length}
				><small>No models here yet: run pi there and /login.</small><//
			>
			<ul class="models">
				<${Show} when=${() => models().length}>
					<${AgentRow} to=${() => choice()} agents=${() => agents()}>
						<select
							class="swap"
							aria-label="Model"
							title="model"
							value=${() => choice().model ?? ''}
							onClick=${stop}
							onChange=${(e) => configure({ ...choice(), model: e.currentTarget.value })}
						>
							<${For} each=${() => models()}
								>${(model) => html`<option value=${() => model}>${() => model}</option>`}<//
							>
						</select>
						<input
							type="range"
							min="0"
							max=${() => THINKING_LEVELS.length}
							aria-label="Thinking"
							value=${() => THINKING_LEVELS.indexOf(choice().thinkingLevel) + 1}
							title=${() => choice().thinkingLevel || 'default thinking'}
							onClick=${stop}
							onInput=${(e) =>
								configure({
									...choice(),
									thinkingLevel: THINKING_LEVELS[e.currentTarget.value - 1],
								})}
						/>
					<//>
				<//>
				<${For} each=${() => others()}
					>${(to) => html`
						<${AgentRow} to=${() => to} agents=${() => agents()}>
							<span class="name" title=${() => to.model}>${() => to.name ?? to.model}</span>
						<//>
					`}<//
				>
			</ul>
		</div>
	`
}

function AgentRow(props) {
	const agents = () => props.agents.filter((a) => agentKey(a.to) === agentKey(props.to))
	const call = () =>
		agents()
			.map((a) => lastToolCall(doing[a.thread]?.[a.name]))
			.find(Boolean)
	return html`
		<li data-agent=${() => agentKey(props.to)}>
			${() => props.children}
			<${Show} when=${() => agents().length}
				><${Dot} state=${() => busiest(agents())} title=${() => busiest(agents()) || 'idle'}
			/><//>
			<${Show} when=${() => call()}
				><span class="hands" title=${() => call()}>${() => call()}</span><//
			>
		</li>
	`
}

/** The chat's runner list is also where you find the command for connecting another machine. */
export function RunnerList() {
	let button, panel
	const online = () => runners.filter((r) => r.online).length
	return html`
		<button
			class="runner-toggle"
			type="button"
			ref=${(el) => (button = el)}
			onClick=${() => panel.togglePopover()}
		>
			<${For} each=${() => runners}
				>${(r) => html`<${Dot} state=${() => (r.online ? 'on' : '')} />`}<//
			>
			<span>${() => `${online()} runner${online() === 1 ? '' : 's'} online`}</span>
		</button>
		<div
			class="runner-list"
			popover
			ref=${(el) => (panel = el)}
			onToggle=${(e) => {
				if (e.newState === 'open') placePopover(panel, button)
			}}
		>
			<ul>
				<${For} each=${() => runners}>${(r) => html`<${RunnerItem} runner=${() => r} />`}<//>
			</ul>
			<p>To add a runner:</p>
			<pre>${() => runnerCommand()}</pre>
		</div>
	`
}

function RunnerItem(props) {
	const work = () =>
		threads.flatMap((t) =>
			t.agents
				.filter((a) => a.to.runner === props.runner.name && a.status === 'working')
				.map((a) => ({ thread: t.id, title: t.title, name: a.name })),
		)
	const call = () =>
		work()
			.map((a) => lastToolCall(doing[a.thread]?.[a.name]))
			.find(Boolean)
	return html`
		<li>
			<${Dot} state=${() => (props.runner.online ? (work().length ? 'working' : 'on') : '')} />
			<div>
				<b>${() => props.runner.name}</b><small>${() => props.runner.dir}</small>
				<${Show} when=${() => !props.runner.online || work().length}>
					<small class=${() => ({ doing: props.runner.online })}
						>${() =>
							!props.runner.online
								? 'offline'
								: call() ||
									`working in ${work()
										.map((a) => a.title || 'untitled')
										.join(', ')}`}</small
					>
				<//>
			</div>
		</li>
	`
}
