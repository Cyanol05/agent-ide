/** A runner helper returns only once connected, or rejects when startup exits. */
import { api, check, done, runner, server } from './lib.js'
await server()
await runner('ready')
check((await api('GET', '/api/runners')).json.some((row) => row.name === 'ready' && row.online), 'the runner is online when startup returns')
let rejected = false
try {
	await runner('broken', { args: ['--not-a-runner-option'] })
} catch (error) {
	rejected = /exited before connecting/.test(error.message)
}
check(rejected, 'startup rejects if the runner exits before connecting')
done()
