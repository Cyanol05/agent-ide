import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const SendToBackActionUtil = registerActionUtil(
	class SendToBackActionUtil extends AgentActionUtil {
		static type = 'sendToBack'
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
			this.editor.sendToBack(action.shapeIds.map((shapeId) => `shape:${shapeId}`))
		}
	},
)
