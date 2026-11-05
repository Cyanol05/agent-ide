/** A reader from a lost connection cannot read or close a new connection's file. */
import { writeFile } from 'node:fs/promises'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createRunners, remoteEnv, serveRunner } from '../remote.js'
import { check, dir, done } from './lib.js'

await writeFile(`${dir}/a`, 'AAA\n')
await writeFile(`${dir}/b`, 'BBB\n')
const runners = createRunners({ onChange() {} })
const connect = () => {
	const runner = serveRunner({ name: 'laptop', dir, send: (text) => runners.receive(text) })
	const connection = runners.connection('laptop')
	runners.register(connection)
	runners.connect(connection, (text) => runner.receive(text))
	return Object.assign(runner, { connection })
}
const env = remoteEnv(runners, 'laptop', dir)
let runner = connect()
const a = await env.openTextLineReader('a', {}, context)
check(a.ok, 'open a on the first connection')
runners.disconnect(runner.connection)
await runner.stopAll()
runner = connect()
const b = await env.openTextLineReader('b', {}, context)
check(b.ok, 'open b on the new connection')
const stale = await a.value.readLine(context)
check(!stale.ok && stale.error.code === 'invalid', 'the old reader cannot read b')
await a.value.close(context)
const current = await b.value.readLine(context)
check(current.ok && current.value.text === 'BBB', 'closing the old reader leaves b open')
await b.value.close(context)
runners.disconnect(runner.connection)
await runner.stopAll()
done()
