/** A fact deep in a long thread survives every merge above it, and the agent finds it. */
import { answers, check as checked, linesOf, until, view } from './lib.js'
import { bench, bot, check, done, evidence, post, settled, steps } from './real-model-bench.js'
await bench()
const N = 64,
	NEEDLE = 7,
	CODE = String(1000 + Math.floor(Math.random() * 9000))
/** Each message is about 300 bytes of distinct small facts, so it is its own line and every pair needs the writer */
const teams = ['build', 'garden', 'kitchen', 'archive', 'radio', 'harbour', 'library', 'workshop']
const fact = (k) =>
	`${teams[k % 8]} team, ticket ${1000 + k}: moved crate ${((k * 37) % 900) + 100} from shelf ${k % 13} to bay ${(k * 7) % 31}, ` +
	`logged ${(k * 11) % 60} minutes, and asked whether the ${teams[(k + 3) % 8]} rota for week ${k % 52} still stands.`
const body = (k) => (k === NEEDLE ? `${fact(k)} Also: the locker code is ${CODE}.` : fact(k))

const home = await bot('Kira')
// Asked once first, so the bot is in its home and writes the lines as the messages come
await post(home, 'Facts follow, one per message. Just read them.', 'Kira')
await settled()
for (let k = 0; k < N; k++) await post(home, body(k), null)
// The needle's place in the thread, after the first question and its answer
const at = (await view(home)).entries.findIndex((entry) => entry.data.body.includes(CODE))
const levels = [...Array(Math.log2(N) + 1).keys()]
/** Every message's line, and each merge above the needle up to one over the first N messages */
const all = await until(
	async () => {
		const lines = await linesOf(home)
		const has = (l, i) => lines.find((x) => x.l === l && x.i === i)
		return (
			lines.filter((x) => x.l === 0).length >= N + 2 &&
			levels.every((l) => has(l, at >> l)) &&
			lines
		)
	},
	30 * 60000,
	2000,
)
check(Boolean(all), 'the lines above the needle are built')
const above = levels.map((l) => (all || []).find((x) => x.l === l && x.i === at >> l))
for (const [l, x] of above.entries())
	checked(
		x?.text.includes(CODE),
		`line ${(at >> l) << l}+${2 ** l} holds the code`,
		'(lost in a merge; reported, not scored)',
	)
await post(home, 'What is the locker code?', 'Kira')
await settled(600000)
const [result] = await evidence([home])
check(
	answers(result).some((entry) => entry.data.author === 'Kira' && entry.data.body.includes(CODE)),
	'the answer has the locker code',
)
steps('Kira', 4)
done()
