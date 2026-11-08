/** MODULES=+bots: a bot keeps the hue someone picked for it until it's cleared back to the one it would have */
import { api, check, done, say, scriptedRunner, server } from './lib.js'

await server({ MODULES: '+bots' })
await scriptedRunner('laptop', () => say('hi'))
const ada = async () => (await api('GET', '/api/bots')).json.find((bot) => bot.name === 'ada')

await api('POST', '/api/bots', { name: 'ada', to: 'echo/echo@laptop' })
check(
	(await ada()).color === undefined,
	'a new bot has no colour of its own',
	JSON.stringify(await ada()),
)

const picked = await api('POST', '/api/bots', { name: 'ada', color: 187.5 })
await api('POST', '/api/bots', { name: 'ada', instructions: 'Review diffs.' })
check(
	picked.status === 201 && (await ada()).color === 187.5,
	'a picked hue stays when something else about the bot changes',
	JSON.stringify([picked.json, await ada()]),
)

const wrong = await api('POST', '/api/bots', { name: 'ada', color: 'teal' })
check(
	wrong.status >= 400 && (await ada()).color === 187.5,
	'a colour that is not a hue is refused',
	JSON.stringify(wrong.json),
)

await api('POST', '/api/bots', { name: 'ada', color: null })
check((await ada()).color === undefined, 'null clears it', JSON.stringify(await ada()))

done()
