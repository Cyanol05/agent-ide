/** Without DB_PATH, ade keeps ade.sqlite, ade.log and ade.json in ~/.config/ade, whatever folder it starts in */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { api, check, dir, done, home, kill, server } from './lib.js'

const config = path.join(home, '.config', 'ade')
const env = { DB_PATH: undefined, XDG_CONFIG_HOME: '', HOME: home }
const elsewhere = path.join(dir, 'elsewhere')
mkdirSync(elsewhere)

const first = await server(env, { cwd: dir })
const { file } = (await api('GET', '/api/server')).json
check(file === path.join(config, 'ade.sqlite'), 'the store is ~/.config/ade/ade.sqlite', file)
check(existsSync(path.join(config, 'ade.log')), 'its log is ade.log beside it')
check(
	!readdirSync(dir).some((name) => /^ade\./.test(name)),
	'nothing lands in the folder it starts in',
)
const {
	json: { id },
} = await api('POST', '/api/threads', { title: 'kept' })
await kill(first)

writeFileSync(path.join(config, 'ade.json'), JSON.stringify({ modules: ['+web-search'] }))
const second = await server(env, { cwd: elsewhere })
const { json: thread } = await api('GET', `/api/threads/${id}`)
check(
	thread.title === 'kept',
	'started in another folder, it has the same threads',
	JSON.stringify(thread),
)
const { modules } = (await api('GET', '/api/server')).json
check(
	modules.includes('web-search'),
	'and reads its settings from ~/.config/ade/ade.json',
	JSON.stringify(modules),
)
await kill(second)
done()
