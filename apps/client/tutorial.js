// The story's side of the page: the section in view says what the stage shows, and the buttons in the text set
// the stage up and press go. The app knows nothing of it.
import { $ } from './dom.js'
import { formatAgent } from './agent.js'
import { api, ask, choose, current, entries, fork, openThread, runners, settingFor, url } from './state.js'

const sections = new IntersectionObserver(
	(list) => {
		for (const e of list) if (e.isIntersecting) $('stage').dataset.focus = e.target.dataset.focus
	},
	{ rootMargin: '-45% 0px -45% 0px' },
)
document.querySelectorAll('.page > section').forEach((s) => sections.observe(s))

const defaults = () =>
	runners
		.filter((r) => r.online && settingFor(r).model)
		.map((r) => ({ runner: r.name, ...settingFor(r) }))
const fresh = () => {
	if (current) openThread(null)
}
const SHED = [
	[
		'Oskar',
		'Shall we finally build the shed this spring? The old one is rotting behind the plum tree.',
	],
	['Ana', 'Yes. I measured the spot: 2.4 by 1.8 metres, flat except the corner by the fence.'],
	['Oskar', 'The allotment gate code is 4417, by the way, for when the timber gets delivered.'],
	['Ben', "I can borrow my uncle's mitre saw from April."],
	['Ana', "Budget? I'd say 6,000 kroner at most."],
	[
		'Oskar',
		"Agreed, 6,000. I went through Stark's price list last night, so here's roughly where it goes.\n\nTimber is the big one: about 3,200 for the frame, the cladding and the floor. The frame is 45×95 studs, the cladding 19 mm boards, the floor 22 mm plywood on joists. Then roofing, which depends on what we pick: felt is around 600, metal closer to 1,400. Screws, nails, hinges and brackets come to about 500 if we buy the big boxes. Paint is another 700 or so for two coats.\n\nThat leaves maybe 600 for whatever we forget, and we always forget something. The concrete blocks for the foundation we already have from the old greenhouse, so those are free.",
	],
	['Ben', 'Roof: felt or corrugated metal? Metal is loud in the rain but lasts forever.'],
	['Ana', 'Felt. The neighbours complained about the last metal roof.'],
	['Oskar', 'Felt it is. Walls: I vote green, like the gate.'],
	['Ana', 'Green is fine by me.'],
	['Ben', 'Foundation: concrete blocks, not a slab. Cheaper, and we can move it.'],
	[
		'Ana',
		"Cut list for the frame, so we can get Stark to cut it and save a day:\n\n- Floor joists: 5 at 1.8 m\n- Bottom and top plates: 4 at 2.4 m, 4 at 1.8 m\n- Studs: 14 at 2.0 m for the front, 14 at 1.8 m for the back, which gives the roof its slope\n- Rafters: 6 at 2.1 m, with a 15 cm overhang front and back\n- Noggins: whatever is left over\n\nThe slope comes out at about 6 degrees, which the felt is fine with as long as we lap it 10 cm. The door goes in the front wall, left of centre, so the shelves can go on the left wall. I've drawn it all on squared paper and taped it to the fridge.",
	],
	['Ana', 'Did it Saturday. Took two wheelbarrows of gravel.'],
	['Ben', 'Timber arrives Thursday the 17th, between 8 and 10.'],
	['Oskar', "I'll be there to open the gate."],
	['Ana', "The delivery guy said the code didn't work, so I let him in."],
	['Oskar', 'Ugh, the association changed it. The new gate code is 9021.'],
	[
		'Ben',
		"Frame is up! Took all of Sunday, and here's what happened, for the record.\n\nWe started at 9 and the first hour went on the joists, because the blocks by the fence weren't quite level after all and Ana had to add another shovel of gravel. The front wall went up easily. The back wall was a fight: one of the 1.8 m studs had a split we didn't see, so we cut a replacement from a 2.0 m and it's 3 mm short, packed with a shim. Rafters went on at 3. The overhang at the back is 15 cm as planned, at the front it's more like 18 because we measured from the outside of the plate.\n\nNothing is square to the millimetre, but it's square enough that the door will hang. My thumb is blue from the hammer.",
	],
	['Ana', "Door: we have the old one from my mum's house, 80 cm wide."],
	['Oskar', "The frame opening is 78 cm. We'll need to plane 2 cm off."],
	['Ben', "Planed it. It fits, a little tight when it's damp."],
	['Ana', 'Roof felt bought: two rolls, 640 kroner.'],
	['Oskar', 'Running total: 4,950 kroner.'],
	['Ben', 'Changed my mind on the colour: green clashes with the new fence. Blue?'],
	['Ana', 'Blue, dark, like a fishing hut.'],
	['Oskar', "Fine, dark blue. I'll return the green paint, 380 back."],
	['Ana', 'Paint bought: dark blue, two buckets.'],
	['Ben', 'First coat on. The second needs a dry day.'],
	[
		'Oskar',
		"Second coat done. The final accounts, since we said we'd keep them:\n\nTimber 3,180. Roof felt 640. Screws, nails and hinges 540. Green paint 380, returned, so 0. Dark blue paint 760. A replacement stud 45. Gravel 0, from the pile. Beers for Sunday 175, which Ana says don't count but I'm counting.\n\nTotal 5,720, under the 6,000 budget by 280. That's lunch at the café by the allotment, or another bucket of paint when the first coat starts to fade.",
	],
	['Ana', 'Shelves from the leftover timber, Ben?'],
	['Ben', 'Three shelves up on the left wall. The mitre saw goes back to my uncle on Friday.'],
	['Oskar', 'Shed done. Housewarming for the shed on Saturday, bring beers.'],
]
const TRIES = {
	hands: () => {
		fresh()
		choose(defaults().slice(0, 1))
		return ask("Which file in this folder is biggest? Look, don't guess. One line.")
	},
	friend: async () => {
		if (!current) openThread((await api('/api/threads', { title: 'A thread for two' })).id)
		const link = new URL(location.href)
		link.searchParams.set('thread', current)
		link.searchParams.set('user', 'Ana')
		open(link, '_blank')
	},
	// Every runner, or with one, two agents on it: another model if it offers one, and a name each.
	two: () => {
		fresh()
		const [first, ...others] = defaults()
		const other = runners
			.find((r) => r.name === first?.runner)
			?.offers?.find((m) => m !== first.model)
		choose(
			others.length || !first
				? [first, ...others].filter(Boolean)
				: [
						{ ...first, name: 'first' },
						{ ...first, ...(other && { model: other }), name: 'second' },
					],
		)
		return ask('What machine are you on, in which folder, and which model are you? One line.')
	},
	slow: () => {
		fresh()
		choose(defaults().slice(0, 1))
		return ask(
			'Count from 1 to 20 in your shell, one number a second: run `for i in $(seq 1 20); do echo $i; sleep 1; done`. Then say how far you got, in one line.',
		)
	},
	fork: async () => {
		const first = (entries.get(current) ?? []).find((e) => e.data.answer)
		if (!first) throw new Error('Ask something first: a fork starts from a message.')
		return fork(current, first.id)
	},
	// A thread long enough for memory to show: three people building a shed, with facts that change on the way.
	shed: async () => {
		const { id } = await api('/api/threads', { title: 'The shed', requestId: crypto.randomUUID() })
		for (const [i, [author, body]] of SHED.entries()) {
			await fetch(`${url}/api/threads/${id}/entries`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-user': author },
				body: JSON.stringify({ body, to: null, requestId: `shed-${id}-${i}` }),
			})
		}
		openThread(id)
	},
	recall: () => {
		if (!current) throw new Error('Load the example thread first.')
		choose(defaults().slice(0, 1))
		return ask(
			'What is the gate code now, what colour is the shed, and how long are the rafters? Say which message you found each in.',
		)
	},
	talk: () => {
		fresh()
		const [first, second = first] = defaults()
		choose([first])
		return ask(
			`Use your post tool to start a thread asking ${formatAgent(second)} what is in its folder. Wait for its answer, then tell me in one line.`,
		)
	},
}
for (const b of document.querySelectorAll('[data-try]'))
	b.onclick = () => {
		if (matchMedia('(max-width: 1000px)').matches) $('stage').scrollIntoView({ behavior: 'smooth' })
		TRIES[b.dataset.try]().catch((error) => alert(error.message))
	}
