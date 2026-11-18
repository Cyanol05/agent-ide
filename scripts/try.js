/** A scratch ade to click through: its own store and port, a real runner `bot` with a scripted echo model, and one thread it has already answered.
 * The bots and director modules are on, with three bots, ada, bram and cleo, that answer at once, each naming itself, its
 * persona and what it was shown last, so who answered and what they saw read off the reply. Send to one by name (`--to ada`).
 * The director picks too: in a thread of bots, a message naming no one goes to whoever's persona it mentions (review,
 * engineer, design), else nobody.
 * `node scripts/try.js &`, open the address it prints, stop it with the `kill` line it prints. Every server it starts goes with it.
 * The bot's model, echo/try, thinks, writes, reads, edits and runs a command in its folder, then answers in markdown.
 * A message with "post" in it makes it post to a new thread too, or to a bot it names; "slow" makes the command take five seconds, to watch live work, and passes on to the thread it posts to. */
import { api, base, runner, server, shellEnv } from '../examples/lib.js'
import { personas } from '../echo.js'

// MODULES=+web-search layers changes on top of this script's own modules.
const modules = ['+bots,+director', shellEnv.MODULES].filter(Boolean).join(',')
await server({ MODULES: modules, DIRECTOR_MODEL: 'echo/try@bot' })
await runner('bot', {
	dir: process.cwd(),
	env: { MODULES: modules },
})

for (const name of Object.keys(personas))
	await api('POST', '/api/bots', {
		name,
		to: 'echo/try@bot',
		instructions: `You are ${personas[name]}.`,
	})
const { json: thread } = await api('POST', '/api/threads', { title: 'try me' })
await api('POST', `/api/threads/${thread.id}/entries`, {
	body: 'look around',
	to: { runner: 'bot', model: 'echo/try' },
})

console.log(`ade at ${base}/?thread=${thread.id}
the bot works in ${process.cwd()}; send to echo/try@bot, "post" or "slow" in a message for more
bots: ${Object.keys(personas).join(', ')}; from a terminal: export ADE_SERVER=${base}; node cli.js post --to ada hi
stop: kill ${process.pid}`)
