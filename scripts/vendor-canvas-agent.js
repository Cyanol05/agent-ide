/**
 * Refreshes apps/client/canvas/agent from tldraw's agent starter kit: the files the canvas tools use, their TypeScript
 * turned into plain JS, and the actions' JSON schema the server offers agents.
 *
 *   git clone https://github.com/tldraw/agent-template <upstream>
 *   npm i --prefix <tools> typescript tldraw@<ours> zod@4 react@<ours> react-dom@<ours>
 *   node scripts/vendor-canvas-agent.js <upstream> <tools>
 *
 * In the browser `tldraw` and `zod` come from the canvas's own shims, which load them from esm.sh; the schema is made in
 * Node from <tools>' copies. Then `bun fmt`, read the diff, and bump UPSTREAM in canvas/agent/README.md.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [upstream, tools] = process.argv.slice(2).map((dir) => path.resolve(dir))
if (!upstream || !tools) throw new Error('usage: vendor-canvas-agent.js <upstream> <tools>')
const ts = createRequire(path.join(tools, 'x.js'))('typescript')
const repo = path.resolve(import.meta.dirname, '..')
const out = path.join(repo, 'apps/client/canvas/agent')

/** What the canvas tools use, and only that: formats, the actions and their helpers, the lints, what a look reads */
export const FILES = [
	'shared/types/ids-schema.ts',
	'shared/format/FocusedColor.ts',
	'shared/format/FocusedFill.ts',
	'shared/format/FocusedFontSize.ts',
	'shared/format/FocusedGeoShapeType.ts',
	'shared/format/FocusedShape.ts',
	'shared/format/convertFocusedShapeToTldrawShape.ts',
	'shared/format/convertTldrawShapeToFocusedShape.ts',
	'shared/format/convertTldrawShapeToBlurryShape.ts',
	'shared/format/convertTldrawShapesToPeripheralShapes.ts',
	'shared/schema/AgentActionSchemas.ts',
	'client/AgentHelpers.ts',
	'client/agent/managers/BaseAgentManager.ts',
	'client/agent/managers/AgentLintManager.ts',
	'client/actions/AgentActionUtil.ts',
	...[
		'Create',
		'Update',
		'Delete',
		'Move',
		'Label',
		'Resize',
		'Rotate',
		'Align',
		'Distribute',
		'Stack',
		'Place',
		'BringToFront',
		'SendToBack',
		'Pen',
	].map((name) => `client/actions/${name}ActionUtil.ts`),
]
/** The actions agents get, by their `_type`, and the schema each has upstream */
export const ACTIONS = {
	create: 'CreateAction',
	update: 'UpdateAction',
	delete: 'DeleteAction',
	move: 'MoveAction',
	label: 'LabelAction',
	resize: 'ResizeAction',
	rotate: 'RotateAction',
	align: 'AlignAction',
	distribute: 'DistributeAction',
	stack: 'StackAction',
	place: 'PlaceAction',
	bringToFront: 'BringToFrontAction',
	sendToBack: 'SendToBackAction',
	pen: 'PenAction',
}

/** One file as plain JS; imports of types alone go, `tldraw` and `zod` come from `shims` (a folder) or as they are */
function port(file, shims) {
	const source = readFileSync(path.join(upstream, file), 'utf8')
	let { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			verbatimModuleSyntax: false,
			useDefineForClassFields: true,
		},
	})
	const up = path.relative(path.dirname(file), '.') || '.'
	outputText = outputText.replace(/from '(\.[^']*)'/g, "from '$1.js'")
	if (shims)
		outputText = outputText.replace(
			/from '(tldraw|zod)'/g,
			(_, name) => `from '${up === '.' ? '.' : up}/../${name}.js'`,
		)
	return outputText
}

rmSync(out, { recursive: true, force: true })
const scratch = path.join(tools, 'ported')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
writeFileSync(path.join(scratch, 'package.json'), '{"type":"module"}')
for (const file of FILES) {
	const js = file.replace(/\.ts$/, '.js')
	mkdirSync(path.dirname(path.join(out, js)), { recursive: true })
	writeFileSync(path.join(out, js), port(file, true))
	mkdirSync(path.dirname(path.join(scratch, js)), { recursive: true })
	writeFileSync(path.join(scratch, js), port(file, false))
}
cpSync(path.join(upstream, 'LICENSE.md'), path.join(out, 'LICENSE.md'))

// The schema, from the same files in Node, where tldraw and zod are <tools>' own
const schemas = await import(
	pathToFileURL(path.join(scratch, 'shared/schema/AgentActionSchemas.js')).href
)
const { z } = await import(
	pathToFileURL(createRequire(path.join(tools, 'x.js')).resolve('zod')).href
)
const union = z.union(Object.values(ACTIONS).map((name) => schemas[name]))
const schema = z.toJSONSchema(union, {
	override: ({ jsonSchema }) => {
		delete jsonSchema._systemPromptCategory
	},
})
delete schema.$schema
writeFileSync(path.join(out, 'actions.schema.json'), `${JSON.stringify(schema, null, '\t')}\n`)
const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {
	encoding: 'utf8',
}).trim()
console.log(`ported ${FILES.length} files from ${commit}; now bun fmt`)
process.exit(0)
