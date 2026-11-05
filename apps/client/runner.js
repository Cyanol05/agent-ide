/** Runners show their agents and choose whom the composer asks. */
import html from '@solidjs/html'
import { createSignal, For, Show } from 'solid-js'
import { api, minted, runners, server, setMinted, threads } from './server.js'
import { agentKey, busiest, doing, lastToolCall, THINKING_LEVELS } from './agent.js'
import { choiceFor, choose, configure, recipients } from './composer.js'
import { placePopover } from './popover.js'
import { report } from './notice.js'
import { Sure } from './sure.js'
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
			<${Show} when=${() => runner().dir && !models().length}
				><small>No models here yet: run pi there and /login.</small><//
			>
			<${Show} when=${() => !runner().dir}><small>Waiting for it to dial in.</small><//>
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
			.map((a) => lastToolCall(doing[a.thread]?.[a.conversation]))
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

/** The chat's runner list: who's there, and where you connect another machine or revoke one. */
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
			<${ConnectRunner} />
		</div>
	`
}

function RunnerItem(props) {
	const work = () =>
		threads.flatMap((t) =>
			t.agents
				.filter((a) => a.to.runner === props.runner.name && a.status === 'working')
				.map((a) => ({ thread: t.id, title: t.title, conversation: a.conversation })),
		)
	const call = () =>
		work()
			.map((a) => lastToolCall(doing[a.thread]?.[a.conversation]))
			.find(Boolean)
	const revoke = async (_e) => {
		const { name } = props.runner
		try {
			await api(`/api/runners/${encodeURIComponent(name)}`, undefined, 'DELETE')
			if (minted()?.name === name) setMinted(null)
		} catch (e) {
			report(e)
		}
	}
	return html`
		<li>
			<${Dot} state=${() => (props.runner.online ? (work().length ? 'working' : 'on') : '')} />
			<div>
				<b>${() => props.runner.name}</b>
				<small>${() => props.runner.dir ?? 'waiting for it to dial in'}</small>
				<${Show} when=${() => props.runner.dir && (!props.runner.online || work().length)}>
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
			<${Show} when=${() => server().local}>
				<${Sure}
					class="revoke"
					title="Take its key away"
					ask="revoke?"
					why=${() =>
						"It goes offline and can't dial back; threads that asked it wait for the name." +
						(props.runner.own
							? " It's the server's own runner, so it's back when the server restarts, unless RUNNER=0."
							: '')}
					onConfirm=${revoke}
					>revoke<//
				>
			<//>
		</li>
	`
}

/** A name makes a key and the command that connects it; a name already in the list gets a new one. */
export function ConnectRunner(props) {
	const [name, setName] = createSignal(props.name ?? '')
	const [error, setError] = createSignal('')
	const [busy, setBusy] = createSignal(false)
	const [copied, setCopied] = createSignal(false)
	// A new key for an online runner cuts it off, so the button asks first, in its own words.
	const [cutting, setCutting] = createSignal(false)
	const existing = () => runners.find((r) => r.name === name().trim())
	const submit = async (e) => {
		e.preventDefault()
		if (existing()?.online && !cutting()) return setCutting(true)
		setCutting(false)
		setBusy(true)
		setError('')
		try {
			setMinted(await api('/api/runners', { name: name().trim() }))
			setName('')
			setCopied(false)
		} catch (e) {
			setError(e.message)
		} finally {
			setBusy(false)
		}
	}
	const copy = () =>
		navigator.clipboard
			.writeText(minted().connect)
			.then(() => setCopied(true))
			.catch(report)
	return html`
		<div class="connect-runner">
			<${Show}
				when=${() => server().local}
				fallback=${html`
					<p class="mute">Add and revoke runners from the server's own machine.</p>
				`}
			>
				<form onSubmit=${submit}>
					<input
						aria-label="Runner name"
						placeholder="a name, like laptop"
						spellcheck="false"
						autocomplete="off"
						required
						value=${() => name()}
						onInput=${(e) => {
							setName(e.currentTarget.value)
							setCutting(false)
						}}
					/>
					<button type="submit" disabled=${() => busy()} onBlur=${(_e) => setCutting(false)}>
						${() => (cutting() ? 'Cut it off?' : existing() ? 'New key' : 'Add runner')}
					</button>
				</form>
				<${Show} when=${cutting}>
					<p class="mute">
						${() =>
							`${name().trim()} is online. A new key cuts it off until you run the new command there.`}
					</p>
				<//>
				<${Show} when=${() => error()}><p class="bad">${() => error()}</p><//>
				<${Show} when=${minted}>
					<div class="command">
						<pre>${() => minted().connect}</pre>
						<button type="button" onClick=${copy}>${() => (copied() ? 'Copied' : 'Copy')}</button>
					</div>
					<p class="mute">
						${() =>
							`Run it on ${minted().name}, in the folder agents should work in. ` +
							'It holds the key, so keep it private.'}
					</p>
				<//>
			<//>
		</div>
	`
}
