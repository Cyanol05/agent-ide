/** Closing or replacing a runner during registration never brings its old connection online. */
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { createRunners } from '../remote.js'
import { check, done, repo } from './lib.js'

const source = await readFile(`${repo}/server.js`, 'utf8')
const upgrade = source.slice(source.indexOf('async function upgrade('), source.indexOf('/** The server connects this machine too'))
const deferred = () => {
	let resolve
	const promise = new Promise((r) => { resolve = r })
	return { promise, resolve }
}

for (const stage of ['key', 'known', 'commit']) {
	for (const ending of ['close', 'error', 'replace']) {
		if (stage === 'key' && ending === 'replace') continue
		const entered = deferred(), resume = deferred()
		const sockets = new Map(), records = {}, ready = []
		const runners = createRunners({ onChange() {} })
		let socket, first = true
		const pause = async (at) => {
			if (!first || stage !== at) return
			first = false
			entered.resolve()
			await resume.promise
		}
		const context = vm.createContext({
			URL, console: { log() {} }, sockets, clients: new Set(), watch() {},
			wss: { handleUpgrade(req, raw, head, accept) { accept(socket) } },
			origin: () => 'http://localhost',
			keys: async () => { await pause('key'); return { laptop: 'hashed' } },
			context: {}, sha256: () => 'hashed',
			known: async () => { await pause('known'); return {} },
			commit: async (fn) => fn({ doc: async () => { await pause('commit'); return records } }),
			Runners: {}, models: { getProvider: () => true }, runners,
			speaker: (s) => s, runnerProvider() {}, bundle: { version: 'v' },
			outdated: new Map(), notify() {},
		})
		vm.runInContext(upgrade, context)
		const connect = (dir) => {
			socket = new EventEmitter()
			const connected = socket
			socket.send = () => ready.push(dir)
			socket.close = socket.terminate = () => connected.emit('close')
			return context.upgrade({
				url: `/ws?runner=laptop&dir=${dir}`,
				headers: { authorization: 'Bearer key' },
			}, {}, null)
		}
		const pending = connect('/old')
		const old = socket
		await entered.promise
		if (ending === 'replace') await connect('/new')
		else old.emit(ending)
		resume.resolve()
		await pending
		if (ending === 'replace') {
			old.emit('close')
			check(runners.isOnline('laptop') && sockets.get('laptop') === socket &&
				records.laptop.dir === '/new' && ready.join() === '/new',
				`replacement during ${stage} keeps only the new connection`)
		} else {
			check(!runners.isOnline('laptop') && !sockets.has('laptop') && !ready.length,
				`${ending} during ${stage} leaves the runner offline`)
		}
	}
}
done()
