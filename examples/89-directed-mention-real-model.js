/** A mention in a group asks only that bot. */
import { answers } from './lib.js'
import { bench, bot, check, done, evidence, post, settled, thread } from './real-model-bench.js'
await bench()
await bot('Kira', 'You are Kira, a gardener.')
await bot('Vera', 'You are Vera, a cook.')
const room = await thread('garden and kitchen')
await post(room, 'Introduce yourselves briefly.', ['Kira', 'Vera'])
await settled()
const [before] = await evidence([room])
const boundary = before.entries.at(-1)?.id || 0
await post(room, '@Vera what is a good way to cook carrots?')
await settled()
const [after] = await evidence([room])
const replies = answers(after).filter((entry) => entry.id > boundary)
check(
	replies.length === 1 && replies[0].data.author === 'Vera',
	'only Vera answers the directed mention',
)
done()
