/** The example opens with real recorded memory, without a runner or any model calls. */
import { loadShed } from '../apps/client/tutorial-shed.js'
import { lines } from '../apps/client/tutorial-shed-memory.js'
import { api, base, check, done, linesOf, server, view } from './lib.js'
await server({ MODULES: '+memory,-auto-title,-director' })
let opened
let ready
const id = await loadShed(base, (id) => {
	opened = id
	ready = api('GET', `/api/threads/${id}/memory?budget=1`)
})
check(opened === id && (await view(id)).memory === true, 'the example opens with memory on')
check((await linesOf(id)).length === 63, 'all 32 leaf lines and their pairs are loaded')
check(
	JSON.stringify((await ready).json.lines) === JSON.stringify([lines.at(-1)]),
	'the complete recorded tree is ready when the thread opens',
)
const zoom = (await api('GET', `/api/threads/${id}/memory?zoom=16,1`)).json.message
check(
	zoom.includes('Oskar:') && zoom.includes('9021'),
	'zoom opens the original gate-code correction',
)
check((await view(id)).agents.length === 0, 'loading never asks an agent')
check((await api('GET', '/api/runners')).json.length === 0, 'loading needs no runner')
done()
