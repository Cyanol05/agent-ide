import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** A module exports `server(core)` and/or `runner(core)`, which return its hooks */
export async function load(end, defaults, core) {
	const file = path.resolve('agent-ide.json')
	const text = await readFile(file, 'utf8').catch((error) => {
		if (error.code === 'ENOENT') return '{}'
		throw error
	})
	let config
	try {
		config = JSON.parse(text)
	} catch (error) {
		throw new Error(`${file}: ${error.message}`)
	}
	let on = Object.keys(defaults).filter((name) => defaults[name])
	for (const [where, list] of [
		[file, config.modules],
		['MODULES', process.env.MODULES ? process.env.MODULES.split(',') : undefined],
	])
		if (list) on = pick(on, list, where)
	const theirs = (name) => !name.includes('/') && !(name in defaults)
	if (end === 'server' && on.some(theirs)) throw new Error(`no module named ${on.find(theirs)}`)
	on = on.filter((name) => !theirs(name))
	const modules = []
	for (const name of on) {
		const own = name.includes('/')
		const make = (
			await import(own ? pathToFileURL(path.resolve(name)).href : `./modules/${name}.js`)
		)[end]
		const named = own ? path.basename(name, '.js') : name
		if (modules.some((m) => m.name === named))
			throw new Error(`${file}: two modules are named ${named}; rename one`)
		if (make) modules.push({ name: named, ...(await make(core)) })
	}
	return modules
}

function pick(on, list, where) {
	if (!Array.isArray(list))
		throw new Error(`${where}: modules is a list, like ["+search", "-talk"]`)
	const changes = list.filter((name) => /^[+-]/.test(name))
	if (!changes.length) return list
	if (changes.length < list.length)
		throw new Error(`${where}: names can't be mixed with +name or -name`)
	return changes.reduce(
		(on, change) =>
			change[0] === '+'
				? [...new Set([...on, change.slice(1)])]
				: on.filter((name) => name !== change.slice(1)),
		on,
	)
}
