import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const DistributeActionUtil = registerActionUtil(
	class DistributeActionUtil extends AgentActionUtil {
		static type = 'distribute'
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
		applyAction(action) {
			if (!action.complete) return
			this.editor.distributeShapes(
				action.shapeIds.map((id) => `shape:${id}`),
				action.direction,
			)
		}
	},
)
