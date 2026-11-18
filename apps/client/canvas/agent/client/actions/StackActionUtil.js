import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const StackActionUtil = registerActionUtil(
	class StackActionUtil extends AgentActionUtil {
		static type = 'stack'
		getInfo(action) {
			return {
				icon: 'cursor',
				description: action.intent ?? '',
			}
		}
		sanitizeAction(action, helpers) {
			if (!action.complete) return action
			action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds)
			return action
		}
		applyAction(action) {
			if (!action.complete) return
			this.editor.stackShapes(
				action.shapeIds.map((id) => `shape:${id}`),
				action.direction,
				Math.max(action.gap, 0),
			)
		}
	},
)
