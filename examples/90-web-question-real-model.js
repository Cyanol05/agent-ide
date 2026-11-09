/** A current question calls the enabled web search before answering. */
import { answers } from './lib.js'
import { bench, bot, check, done, evidence, post, settled, steps } from './real-model-bench.js'
await bench({ web: true })
const home = await bot('Kira')
await post(
	home,
	`As of today (${new Date().toISOString().slice(0, 10)}), what is the latest stable Node.js release? Include a source URL.`,
	'Kira',
)
await settled()
const [result] = await evidence([home])
check(
	result.calls.some((call) => call.name === 'web_search' && call.arguments.query?.trim()),
	'searches the web for the current release',
)
check(
	answers(result).some(
		(entry) => entry.data.author === 'Kira' && /https?:\/\//.test(entry.data.body),
	),
	'answers with a source URL',
)
steps('Kira', 3)
done()
