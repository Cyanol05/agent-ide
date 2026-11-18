#!/usr/bin/env node
/** One executable; each program still owns its arguments. */
// Old Node can't parse the rest, so this stays first and in old syntax; the imports below are dynamic.
if (Number(process.versions.node.split('.')[0]) < 24) {
	console.error('ade needs Node 24 or newer, and you have v' + process.versions.node + '.')
	process.exit(1)
}
const { parseArgs } = await import('node:util')

const args = process.argv.slice(2)
if (args[0] === '--help' || args[0] === '-h') {
	console.log(`ade                   start the server, with this folder as its runner
ade --dir a --dir b   agents work in these folders instead; threads start in the first
ade --no-runner       start the server without lending this machine as a runner
ade runner …          connect this machine to a server (runner --help)
ade post …            and threads, read, wait, runners, key, revoke, stop (post --help)

Threads, settings, the log and runner keys live in ~/.config/ade (ade.sqlite, ade.json, ade.log, key files).
PORT, HOST, DB_PATH and MODULES set the server; the README has the rest.`)
} else if (args[0] === 'runner') {
	process.argv.splice(2, 1)
	await import('./runner.js')
} else {
	// Skip CLI option values too: `--as runner key laptop` still asks the CLI.
	const {
		positionals: [command],
	} = parseArgs({
		args,
		strict: false,
		allowPositionals: true,
		options: Object.fromEntries(
			['server', 'as', 'thread', 'to', 'thinking', 'dir', 'title', 'last', 'after'].map((name) => [
				name,
				{ type: 'string' },
			]),
		),
	})
	await import(
		['post', 'threads', 'read', 'wait', 'runners', 'key', 'revoke', 'stop'].includes(command)
			? './cli.js'
			: './server.js'
	)
}
