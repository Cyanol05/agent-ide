/** Disconnect closes the runner's open readers, not just their handle numbers. */
import { readdir, readlink, writeFile } from 'node:fs/promises'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createRunners, remoteEnv, serveRunner } from '../remote.js'
import { check, dir, done } from './lib.js'

await writeFile(`${dir}/text`, 'text\n')
await writeFile(`${dir}/binary`, 'bytes')
const runners = createRunners({ onChange() {} })
const runner = serveRunner({ name: 'laptop', dir, send: (text) => runners.receive(text) })
const connection = runners.connection('laptop')
runners.register(connection)
runners.connect(connection, (text) => runner.receive(text))
const env = remoteEnv(runners, 'laptop', dir)
const readers = await Promise.all([
	env.openTextLineReader('text', {}, context),
	env.openBinaryReader('binary', {}, context),
	env.openDirReader('.', context),
])
check(readers.every((r) => r.ok), 'open text, binary and directory readers')

// Linux lets us check the actual descriptors, independently of the protocol's handle map.
const descriptors = async () => (await Promise.all(
	(await readdir('/proc/self/fd')).map((fd) => readlink(`/proc/self/fd/${fd}`).catch(() => '')),
)).filter((p) => p === dir || p.startsWith(`${dir}/`))
if (process.platform === 'linux') check((await descriptors()).length === 3, 'all three readers hold descriptors')
runners.disconnect(connection)
await runner.stopAll()
if (process.platform === 'linux') check(!(await descriptors()).length, 'disconnect closes every reader descriptor')
await runner.stopAll()
check(!runners.isOnline('laptop'), 'closing again is harmless and leaves the runner offline')
done()
