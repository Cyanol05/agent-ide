import { toRichText } from '../../../tldraw.js'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
function isShapeWithRichText(shape) {
	return !!(shape && 'richText' in shape.props)
}
function assertShapeWithRichText(shape) {
	if (!isShapeWithRichText(shape)) {
		throw new Error('Shape is not a valid ShapeWithRichText')
	}
}
export const LabelActionUtil = registerActionUtil(
	class LabelActionUtil extends AgentActionUtil {
		static type = 'label'
		getInfo(action) {
			return {
				icon: 'pencil',
				description: action.intent ?? '',
			}
		}
		sanitizeAction(action, helpers) {
			if (!action.complete) return action
			const shapeId = helpers.ensureShapeIdExists(action.shapeId)
			if (!shapeId) {
				return null
			}
			const shape = this.editor.getShape(`shape:${shapeId}`)
			if (!shape) {
				return null
			}
			if (!isShapeWithRichText(shape)) {
				console.warn(`Shape type "${shape.type}" does not support richText labels`)
				return null
			}
			action.shapeId = shapeId
			return action
		}
		applyAction(action) {
			if (!action.complete) return
			const { editor } = this
			const shapeId = `shape:${action.shapeId}`
			const shape = editor.getShape(shapeId)
			assertShapeWithRichText(shape)
			editor.updateShape({
				id: shapeId,
				type: shape.type,
				props: { richText: toRichText(action.text ?? '') },
			})
		}
	},
)
