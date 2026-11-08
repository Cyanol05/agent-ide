/** Each bot introduces itself once, without trying to post to its own thread. */
import { answers } from './lib.js'
import { bench, bot, check, done, evidence, post, settled, thread } from './real-model-bench.js'
await bench()
await bot('Kira', 'You are Kira, a gardener.')
await bot('Vera', 'You are Vera, a cook.')
const room = await thread('introductions')
// Join without asking anything, then exercise the literal group prompt.
await post(room, 'You are both in this group chat.', ['Kira', 'Vera'])
await settled()
const [before] = await evidence([room])
const boundary = before.entries.at(-1)?.id || 0
await post(room, '@Kira @Vera who are you two')
await settled()
const [after] = await evidence([room])
const replies = answers(after).filter((entry) => entry.id > boundary)
for (const name of ['Kira', 'Vera']) {
	const own = replies.filter((entry) => entry.data.author === name)
	check(
		own.length === 1 && new RegExp(`\\b${name}\\b`, 'i').test(own[0]?.data.body || ''),
		`${name} introduces itself exactly once`,
	)
}
check(replies.length === 2, 'nobody else answers')
check(
	!after.calls.some(
		(call) =>
			call.name === 'post' &&
			(call.arguments.thread === room ||
				String(call.arguments.to || '').match(new RegExp(`^${room}(?:/|$)`))),
	),
	'no post to own thread',
)
done()
