/** The walkthrough loads messages and their recorded memory without asking a model. */
import { lines } from './tutorial-shed-memory.js'
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

export async function loadShed(url, open) {
	const post = async (path, body, author = 'you') => {
		const response = await fetch(url + path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-user': author },
			body: JSON.stringify(body),
		})
		const json = await response.json()
		if (!response.ok) throw new Error(json.error)
		return json
	}
	const { id } = await post('/api/threads', { title: 'The shed', requestId: crypto.randomUUID() })
	for (const [index, [author, body]] of SHED.entries())
		await post(
			`/api/threads/${id}/entries`,
			{ body, to: null, requestId: `shed-${id}-${index}` },
			author,
		)
	await post(`/api/threads/${id}/memory`, { lines })
	open(id)
	return id
}
