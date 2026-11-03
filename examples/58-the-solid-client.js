/** Solid and the walkthrough's diagrams come from this server, with no build step or CDN */
import { base, check, done, server } from './lib.js'

await server()
const page = await (await fetch(base)).text()
const imports = JSON.parse(page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports
check(
	page.includes('src="/client.js"') && Object.keys(imports).includes('solid-js'),
	'the only client, at /, is Solid',
)
check(
	!/<script[^>]*src=["']https?:|from ["']https?:/.test(page),
	'the page loads no code from another server',
)
for (const url of ['/client.js', '/client.css', ...Object.values(imports)]) {
	const response = await fetch(base + url)
	check(response.ok && (await response.text()).length > 0, `the server serves ${url}`)
}
const css = await (await fetch(base + '/client.css')).text()
const fonts = [...css.matchAll(/url\(['"]([^'"]+\.woff2)['"]\)/g)].map((m) => m[1])
check(
	fonts.length === 4 && fonts.every((f) => f.startsWith('/fonts/')),
	'all four font styles are local',
)
for (const font of fonts) {
	const response = await fetch(base + font)
	const magic = new TextDecoder().decode((await response.arrayBuffer()).slice(0, 4))
	check(
		response.ok && response.headers.get('content-type') === 'font/woff2' && magic === 'wOF2',
		font,
	)
}
const entry = '/packages/mermaid/mermaid.esm.min.mjs'
const mermaid = await fetch(base + entry)
check(
	mermaid.ok && mermaid.headers.get('content-type').includes('javascript'),
	'Mermaid is local too',
)
const chunk = (await mermaid.text()).match(/from\s*["'](\.\/chunks\/[^"']+)/)?.[1]
const loaded = chunk && (await fetch(new URL(chunk, base + entry)))
check(loaded?.ok && (await loaded.text()).length > 0, 'its chunks are served beside it')
for (const url of [
	'/solid',
	'/solid/client.js',
	'/state.js',
	'/dom.js',
	'/packages/not-installed/index.js',
	'/packages/mermaid/package.json',
	'/packages/solid-js/../../package.json',
	'/packages/solid-js/%2e%2e%2fpackage.json',
	'/packages/solid-js/http://[invalid',
]) {
	check((await fetch(base + url)).status === 404, `${url} is not served`)
}
check((await fetch(base)).ok, 'bad asset paths leave the server running')
done()
