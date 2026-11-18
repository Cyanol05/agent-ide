/** The story's buttons use the same server and picker as the chat. */
import { loadShed } from './tutorial-shed.js'
import { defaultTitle } from './title.js'
import html from '@solidjs/html'
import { Portal } from '@solidjs/web'
import { onSettled, Show, snapshot } from 'solid-js'
import { api, current, createThread, entries, fork, openThread, runners, url } from './server.js'
import { choose, toFor } from './composer.js'
import { ConnectRunner } from './runner.js'
import { report } from './notice.js'
import { Memory } from './agent-memory.js'

export function Tutorial(props) {
	onSettled(() => {
		const stage = document.getElementById('stage')
		const sections = new IntersectionObserver(
			(list) => {
				for (const entry of list)
					if (entry.isIntersecting) stage.dataset.focus = entry.target.getAttribute('data-focus')
			},
			{ rootMargin: '-45% 0px -45% 0px' },
		)
		document.querySelectorAll('.page > section').forEach((section) => sections.observe(section))
		const buttons = [...document.querySelectorAll('[data-try]')]
		const run = async (event) => {
			const button = event.currentTarget
			if (matchMedia('(max-width: 1000px)').matches) stage.scrollIntoView({ behavior: 'smooth' })
			button.disabled = true
			try {
				await TRIES[button.dataset.try]()
			} catch (error) {
				report(error)
			} finally {
				button.disabled = false
			}
		}
		buttons.forEach((button) => button.addEventListener('click', run))
		return () => {
			sections.disconnect()
			buttons.forEach((button) => button.removeEventListener('click', run))
		}
	})
	return html`
		<${Show} when=${() => props.story}
			><${Portal} mount=${document.getElementById('memory')}><${Memory} /><//
		><//>
		<${Portal} mount=${document.getElementById('connect-runner')}
			><${ConnectRunner} name="laptop"
		/><//>
	`
}

const providerOf = (model) => model.split('/')[0]
/** Written with its provider, exactly as the runner lists it, so it can't resolve to another provider's login */
const named = (to) => `${to.model}@${to.runner}`
/** Two small models the online runners offer: Haiku, Luna, Sonnet or Terra, from two providers if possible, then the
 * model the thread is on to fill up. `anthropic/…` is never picked from the list: its login can be expired. */
const smallTwo = () => {
	const small = runners
		.filter((runner) => runner.online && toFor(runner).model)
		.flatMap((runner) =>
			(runner.offers ?? [])
				.filter(
					(model) => /haiku|luna|sonnet|terra/.test(model) && providerOf(model) !== 'anthropic',
				)
				.map((model) => ({ ...toFor(runner), model })),
		)
	const [one = defaults()[0]] = small
	if (!one) return []
	const two =
		small.find((option) => providerOf(option.model) !== providerOf(one.model)) ??
		small.find((option) => option !== one) ??
		defaults()[0]
	return [one, two]
}
const defaults = () =>
	runners.filter((runner) => runner.online && toFor(runner).model).map((runner) => toFor(runner))
async function ask(body, to, was = current()) {
	if (!to) throw new Error('Pick a model first.')
	choose(to)
	const id = was ?? (await createThread(defaultTitle(body)))
	await api(`/api/threads/${id}/entries`, { body, to: snapshot(to) })
}

const fresh = () => openThread(null)
const TRIES = {
	hands: () => {
		fresh()
		return ask(
			"Which file in this folder is biggest? Look, don't guess. One line.",
			defaults()[0],
			null,
		)
	},
	friend: async () => {
		const id = current() ?? (await api('/api/threads', { title: 'A thread for two' })).id
		if (!current()) openThread(id)
		const link = new URL(location.href)
		link.searchParams.set('thread', id)
		link.searchParams.set('user', 'Ana')
		open(link, '_blank')
	},
	slow: () => {
		fresh()
		return ask(
			'Count from 1 to 20 in your shell, one number a second: run `for i in $(seq 1 20); do echo $i; sleep 1; done`. Then say how far you got, in one line.',
			defaults()[0],
			null,
		)
	},
	fork: () => {
		const first = (entries[current()] ?? []).find((entry) => entry.data.answer)
		if (!first) throw new Error('Ask something first: a fork starts from a message.')
		return fork(current(), first.id)
	},
	shed: () => loadShed(url, openThread),
	recall: () => {
		if (!current()) throw new Error('Load the example thread first.')
		return ask(
			'What is the gate code now, what colour is the shed, and how long are the rafters? Say which message you found each in.',
			defaults()[0],
		)
	},
	talk: () => {
		fresh()
		const [one, two] = smallTwo()
		if (!one) throw new Error('Pick a model first.')
		return ask(
			`With your post tool, start two threads at once: one asking ${named(one)}, one asking ${named(two)}, which machine and folder it is in, in one line. Wait for both answers, then tell me in two lines.`,
			one,
			null,
		)
	},
}
