/** Claude Code's one-off "4 blocks with cache_control" 400, after a system prompt change, is retried and the reply goes through */
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { answered, api, check, done, say, scriptedRunner, server } from './lib.js'

await server()
let calls = 0
const bot = await scriptedRunner('bot', () =>
	++calls === 1
		? fauxAssistantMessage([], {
				stopReason: 'error',
				errorMessage:
					'Incomplete Claude Code upstream response (status 400, capture incomplete, native retries denied 1, upstream said: A maximum of 4 blocks with cache_control may be provided. Found 5.)',
			})
		: say('ahoy'),
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'cache markers' })
await api('POST', `/api/threads/${id}/entries`, {
	body: 'say hi',
	to: { runner: 'bot', model: 'echo/echo' },
})
const v = await answered(id, 1, 15000)
const posts = v?.entries.filter((e) => e.data.author === 'echo@bot').map((e) => e.data.body)
check(posts?.includes('ahoy'), 'the retried reply goes through', JSON.stringify(posts))
check(calls === 2, 'the model was asked twice', calls)
bot.close()
done()
