/** The server logs what it prints and how it ended to a file next to its store */
import { existsSync, readFileSync } from 'node:fs'
import { check, db, done, server, until } from './lib.js'

const log = db.replace(/\.sqlite$/, '.log')
const read = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')

// A crash the server doesn't catch, on a signal so it comes once the server is up
const crash = `data:text/javascript,${encodeURIComponent("process.on('SIGUSR2', () => { throw new Error('boom') })")}`
let srv = await server({ NODE_OPTIONS: `--import=${crash}` })
check(/started, process \d+/.test(read()), 'the log says the server started', read())
check(read().includes('agent-ide  http://'), 'the log has what the server printed', read())

const exited = new Promise((resolve) => srv.on('exit', resolve))
srv.kill('SIGUSR2')
await exited
check(/uncaughtException: Error: boom\n.*at /.test(read()), 'the log has the crash and its stack', read())
check(read().includes('exited with code 1'), 'the log says how it ended', read())

srv = await server()
srv.kill('SIGTERM')
await until(async () => read().includes('exited with code 0'))
check(/stopped by SIGTERM\n.*exited with code 0/.test(read()), 'a stop is logged with its signal, after the earlier run', read())
done()
