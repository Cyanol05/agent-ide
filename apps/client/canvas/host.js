/**
 * The canvas's editor host: a browser tab with the canvas open runs agents' looks and actions against its live editor,
 * with tldraw's agent starter kit's own formats, actions, sanitizers and lints (vendored in ./agent). Only what an agent
 * asks for runs here; ade's agent loop, models and chat stay where they are.
 */
import { allDefaultFontFaces, Box, FileHelpers } from './tldraw.js'
import { AgentHelpers } from './agent/client/AgentHelpers.js'
import { AgentLintManager } from './agent/client/agent/managers/AgentLintManager.js'
import { getAgentActionUtilsRecordForMode } from './agent/client/actions/AgentActionUtil.js'
import { convertTldrawShapeToBlurryShape } from './agent/shared/format/convertTldrawShapeToBlurryShape.js'
import { convertTldrawShapesToPeripheralShapes } from './agent/shared/format/convertTldrawShapesToPeripheralShapes.js'
import './agent/client/actions/CreateActionUtil.js'
import './agent/client/actions/UpdateActionUtil.js'
import './agent/client/actions/DeleteActionUtil.js'
import './agent/client/actions/MoveActionUtil.js'
import './agent/client/actions/LabelActionUtil.js'
import './agent/client/actions/ResizeActionUtil.js'
import './agent/client/actions/RotateActionUtil.js'
import './agent/client/actions/AlignActionUtil.js'
import './agent/client/actions/DistributeActionUtil.js'
import './agent/client/actions/StackActionUtil.js'
import './agent/client/actions/PlaceActionUtil.js'
import './agent/client/actions/BringToFrontActionUtil.js'
import './agent/client/actions/SendToBackActionUtil.js'
import './agent/client/actions/PenActionUtil.js'

/** Clusters of shapes out of view are this far apart, as the starter kit has it */
const PERIPHERAL_PADDING = 75
/** A look's picture is at most this many pixels on its longest side */
const PICTURE = 1000
/** A drawing that fits in this many pixels each way is looked at whole by default; a bigger one, where the person is */
const WHOLE = 3000
/** Room around a whole drawing, so its edges show */
const MARGIN = 40

/**
 * tldraw's fonts, loaded once per editor before anything is measured, linted or pictured: an editor nobody looks at
 * never loads them itself, and measures its labels in a stand-in font until it does.
 */
const fonts = new WeakMap()
const fontsLoaded = (editor) => {
	if (!fonts.has(editor))
		fonts.set(
			editor,
			Promise.all(allDefaultFontFaces.map((face) => editor.fonts.ensureFontIsLoaded(face)))
				.then(() => document.fonts.ready)
				// tldraw re-measures on the next frame after a font lands; a page in the background may not draw one soon
				.then(
					() =>
						new Promise((resolve) => (requestAnimationFrame(resolve), setTimeout(resolve, 100))),
				),
		)
	return fonts.get(editor)
}

/** What the starter kit's code asks of its agent: the editor, and where its coordinates start (the page's origin here) */
const agentOf = (editor) => ({ editor, chatOrigin: { getOrigin: () => ({ x: 0, y: 0 }) } })

const short = (id) => id.replace(/^shape:/, '')
const byOf = (shape) => (shape.meta?.by ? { by: shape.meta.by } : {})

/** Shapes whose bounds lie in `bounds`, and the rest */
function split(editor, bounds) {
	const area = Box.From(bounds)
	const inside = [],
		outside = []
	for (const shape of editor.getCurrentPageShapesSorted()) {
		const box = editor.getShapeMaskedPageBounds(shape)
		if (!box) continue
		;(area.includes(box) ? inside : outside).push(shape)
	}
	return { inside, outside }
}

const round = (box) => ({
	x: Math.round(box.x),
	y: Math.round(box.y),
	w: Math.round(box.w),
	h: Math.round(box.h),
})

/**
 * What's in an area, as the starter kit shows a model: shapes in view blurry, the rest as clusters, the lints, and a
 * picture of it; with what the person has selected and the area they have in view, so "this box" means theirs. With no
 * area given, the whole drawing when it's small enough, else what the person has in view.
 */
export async function look(editor, { bounds } = {}) {
	await fontsLoaded(editor)
	const viewport = round(editor.getViewportPageBounds())
	const area = bounds ?? whole(editor) ?? viewport
	const { inside, outside } = split(editor, area)
	const agent = agentOf(editor)
	const blurry = (shape) => {
		const found = convertTldrawShapeToBlurryShape(editor, shape)
		return found && { ...found, ...byOf(shape) }
	}
	return {
		bounds: area,
		viewport,
		selected: editor.getSelectedShapes().map(blurry).filter(Boolean),
		shapes: inside.map(blurry).filter(Boolean),
		peripheral: convertTldrawShapesToPeripheralShapes(editor, outside, {
			padding: PERIPHERAL_PADDING,
		}).map((cluster) => ({
			bounds: round(cluster.bounds),
			numberOfShapes: cluster.numberOfShapes,
		})),
		lints: new AgentLintManager(agent).detectCanvasLints(inside),
		...(inside.length && { picture: await picture(editor, inside, area) }),
	}
}

/** Everything on the page, with a margin, when it's small enough to take in at once */
function whole(editor) {
	const all = editor.getCurrentPageBounds()
	if (!all || all.w > WHOLE || all.h > WHOLE) return undefined
	return round(all.clone().expandBy(MARGIN))
}

/** The area as a JPEG, the starter kit's screenshot made small enough to read cheaply */
async function picture(editor, shapes, area) {
	const scale = Math.min(1, PICTURE / Math.max(area.w, area.h))
	const { blob } = await editor.toImage(shapes, {
		format: 'jpeg',
		quality: 0.8,
		background: true,
		bounds: Box.From(area),
		padding: 0,
		pixelRatio: 1,
		scale,
	})
	const url = await FileHelpers.blobToDataUrl(blob)
	return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
}

/**
 * An arrow's joined end meets the middle of its shape unless the agent put that end inside it: the starter kit pins a
 * joined end to the point nearest x1,y1 or x2,y2, so an agent that leaves them out, or guesses, gets an arrow off a corner
 */
function centred(editor, action) {
	const shape = action._type === 'create' && action.shape
	if (shape?._type !== 'arrow') return action
	for (const [id, x, y] of [
		[shape.fromId, 'x1', 'y1'],
		[shape.toId, 'x2', 'y2'],
	]) {
		const bounds = id && editor.getShapePageBounds(`shape:${id}`)
		if (!bounds || bounds.containsPoint({ x: shape[x], y: shape[y] })) continue
		shape[x] = bounds.center.x
		shape[y] = bounds.center.y
	}
	return action
}

/**
 * A batch of starter-kit actions, in one undo step: each sanitized as the starter kit does, then applied. Answers what
 * each did, the shapes they touched as they landed (as a look shows them, with their real bounds), what was deleted, ids changed to
 * stay unique, and the lints that touch them.
 */
export async function act(editor, { actions }) {
	await fontsLoaded(editor)
	const agent = agentOf(editor)
	const utils = getAgentActionUtilsRecordForMode(agent, 'default')
	const helpers = new AgentHelpers(agent)
	const applied = []
	editor.markHistoryStoppingPoint('agent actions')
	const diff = editor.store.extractingChanges(() =>
		editor.run(() => {
			for (const action of actions) {
				const util = utils[action?._type]
				if (!util) {
					applied.push({ _type: action?._type, skipped: 'no such action' })
					continue
				}
				try {
					const sanitized = util.sanitizeAction(
						structuredClone({ ...action, complete: true }),
						helpers,
					)
					if (!sanitized) {
						applied.push({ _type: action._type, skipped: 'a shape it names is not there' })
						continue
					}
					util.applyAction(centred(editor, sanitized), helpers)
					applied.push({ _type: action._type, ok: true })
				} catch (error) {
					applied.push({ _type: action._type, skipped: error.message })
				}
			}
		}),
	)
	const touched = [...Object.keys(diff.added), ...Object.keys(diff.updated)]
		.map((id) => editor.getShape(id))
		.filter(Boolean)
	const ids = new Set(touched.map((shape) => short(shape.id)))
	const lints = new AgentLintManager(agent)
		.detectCanvasLints(editor.getCurrentPageShapesSorted())
		.filter((lint) => lint.shapeIds.some((id) => ids.has(id)))
	return {
		applied,
		shapes: touched
			.map((shape) => {
				const found = convertTldrawShapeToBlurryShape(editor, shape)
				return found && { ...found, ...byOf(shape) }
			})
			.filter(Boolean),
		deleted: Object.values(diff.removed)
			.filter((record) => record.typeName === 'shape')
			.map((record) => short(record.id)),
		renamed: Object.fromEntries(helpers.shapeIdMap),
		lints,
	}
}
