import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const RotateActionUtil = registerActionUtil(
	class RotateActionUtil extends AgentActionUtil {
		static type = 'rotate'
		getInfo(action) {
			return {
				icon: 'cursor',
				description: action.intent ?? '',
			}
		}
		sanitizeAction(action, helpers) {
			action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
			return action
		}
		applyAction(action, helpers) {
			if (!action.shapeIds || !action.degrees || !action.originX || !action.originY) {
				return
			}
			const origin = helpers.removeOffsetFromVec({ x: action.originX, y: action.originY })
			const shapeIds = action.shapeIds.map((shapeId) => `shape:${shapeId}`)
			const radians = (action.degrees * Math.PI) / 180
			this.editor.rotateShapesBy(shapeIds, radians, { center: origin })
		}
	},
)
