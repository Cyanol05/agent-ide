/** One-off: rewrite the agent-ide.* names stored in an ade.sqlite to ade.*, in place. Stop the server first and copy the file.
 * Usage: node scripts/migrate-ade-names.js path/to/ade.sqlite */
import { DatabaseSync } from 'node:sqlite'

const file = process.argv[2]
if (!file) throw new Error('usage: migrate-ade-names.js <ade.sqlite>')
const db = new DatabaseSync(file)
db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE')

const quoted = (column) =>
	`replace(replace(${column}, '"agent-ide.', '"ade.'), '"agent-ide"', '"ade"')`

let changed = 0
for (const { name: table } of db
	.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
	.all()) {
	for (const { name: column, type } of db.prepare(`PRAGMA table_info(${table})`).all()) {
		if (type !== 'TEXT') continue
		const expression = quoted(column)
		const result = db
			.prepare(`UPDATE ${table} SET ${column} = ${expression} WHERE ${column} LIKE '%agent-ide%'`)
			.run()
		if (result.changes) console.log(`${table}.${column}: ${result.changes}`)
		changed += Number(result.changes)
	}
}
db.exec('COMMIT')
console.log(`${changed} rows rewritten`)
