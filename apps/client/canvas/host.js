/**
 * The canvas's editor host: a browser tab with the canvas open runs agents' looks and actions against its live editor,
 * with tldraw's agent starter kit's own formats, actions, sanitizers and lints (vendored in ./agent). Only what an agent
 * asks for runs here; ade's agent loop, models and chat stay where they are.
 */
import { Box } from './tldraw.js'
import { AgentHelpers } from './agent/client/AgentHelpers.js'
import { AgentLintManager } from './agent/client/agent/managers/AgentLintManager.js'
import { getAgentActionUtilsRecordForMode } from './agent/client/actions/AgentActionUtil.js'
import { convertTldrawShapeToBlurryShape } from './agent/shared/format/convertTldrawShapeToBlurryShape.js'
import { convertTldrawShapeToFocusedShape } from './agent/shared/format/convertTldrawShapeToFocusedShape.js'
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

/** What's in an area, as the starter kit shows a model: shapes in view blurry, the rest as clusters, and the lints */
export function look(editor, { bounds } = {}) {
	const area = bounds ?? round(editor.getViewportPageBounds())
	const { inside, outside } = split(editor, area)
	const agent = agentOf(editor)
	return {
		bounds: area,
		shapes: inside
			.map((shape) => {
				const blurry = convertTldrawShapeToBlurryShape(editor, shape)
				return blurry && { ...blurry, ...byOf(shape) }
			})
			.filter(Boolean),
		peripheral: convertTldrawShapesToPeripheralShapes(editor, outside, {
			padding: PERIPHERAL_PADDING,
		}).map((cluster) => ({
			bounds: round(cluster.bounds),
			numberOfShapes: cluster.numberOfShapes,
		})),
		lints: new AgentLintManager(agent).detectCanvasLints(inside),
	}
}

/**
 * A batch of starter-kit actions, in one undo step: each sanitized as the starter kit does, then applied. Answers what
 * each did, the shapes they touched as they landed (full, with their real bounds), what was deleted, ids changed to
 * stay unique, and the lints that touch them.
 */
export function act(editor, { actions }) {
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
					util.applyAction(sanitized, helpers)
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
		shapes: touched.map((shape) => ({
			...convertTldrawShapeToFocusedShape(editor, shape),
			bounds: round(editor.getShapePageBounds(shape)),
		})),
		deleted: Object.values(diff.removed)
			.filter((record) => record.typeName === 'shape')
			.map((record) => short(record.id)),
		renamed: Object.fromEntries(helpers.shapeIdMap),
		lints,
	}
}
