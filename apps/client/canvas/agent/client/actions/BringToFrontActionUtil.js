import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const BringToFrontActionUtil = registerActionUtil(
	class BringToFrontActionUtil extends AgentActionUtil {
		static type = 'bringToFront'
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
			if (!action.shapeIds) return
			this.editor.bringToFront(action.shapeIds.map((shapeId) => `shape:${shapeId}`))
		}
	},
)
