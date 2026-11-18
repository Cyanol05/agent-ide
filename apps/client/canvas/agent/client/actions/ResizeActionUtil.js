import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const ResizeActionUtil = registerActionUtil(
	class ResizeActionUtil extends AgentActionUtil {
		static type = 'resize'
		getInfo(action) {
			return {
				icon: 'cursor',
				description: action.intent ?? '',
			}
		}
		sanitizeAction(action, helpers) {
			const shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
			if (shapeIds.length === 0) return null
			action.shapeIds = shapeIds
			return action
		}
		applyAction(action, helpers) {
			if (
				!action.shapeIds ||
				!action.scaleX ||
				!action.scaleY ||
				!action.originX ||
				!action.originY
			) {
				return
			}
			const origin = helpers.removeOffsetFromVec({ x: action.originX, y: action.originY })
			const shapeIds = action.shapeIds.map((shapeId) => `shape:${shapeId}`)
			for (const shapeId of shapeIds) {
				this.editor.resizeShape(
					shapeId,
					{ x: action.scaleX, y: action.scaleY },
					{ scaleOrigin: origin },
				)
			}
		}
	},
)
