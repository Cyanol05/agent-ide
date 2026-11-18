import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const DeleteActionUtil = registerActionUtil(
	class DeleteActionUtil extends AgentActionUtil {
		static type = 'delete'
		getInfo(action) {
			return {
				icon: 'trash',
				description: action.intent ?? '',
				canGroup: (other) => other._type === 'delete',
			}
		}
		sanitizeAction(action, helpers) {
			if (!action.complete) return action
			const shapeId = helpers.ensureShapeIdExists(action.shapeId)
			if (!shapeId) return null
			action.shapeId = shapeId
			return action
		}
		applyAction(action) {
			if (!action.complete) return
			this.editor.deleteShape(`shape:${action.shapeId}`)
		}
	},
)
