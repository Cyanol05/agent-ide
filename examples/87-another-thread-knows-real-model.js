/** A fact found only in another thread must be read or asked for, not guessed. */
import { randomUUID } from 'node:crypto'
import { answers } from './lib.js'
import { bench, bot, check, done, evidence, post, settled, thread } from './real-model-bench.js'
await bench()
const source = await thread('locker record')
const nonce = randomUUID()
await post(source, `The locker recovery token is ${nonce}.`, null)
const home = await bot('Kira')
await post(home, `What is the exact locker recovery token recorded in thread ${source}?`, 'Kira')
await settled()
const [result] = await evidence([home])
check(
	answers(result).some((entry) => entry.data.author === 'Kira' && entry.data.body.includes(nonce)),
	'answer contains the hidden token',
)
check(
	result.calls.some(
		(call) =>
			['threads', 'post'].includes(call.name) &&
			(call.arguments.thread === source ||
				String(call.arguments.to || '').match(new RegExp(`^${source}(?:/|$)`))),
	),
	'reads or asks the source thread',
)
done()
