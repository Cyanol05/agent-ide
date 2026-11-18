import { AgentActionUtil, registerActionUtil } from './AgentActionUtil.js'
export const AlignActionUtil = registerActionUtil(
	class AlignActionUtil extends AgentActionUtil {
		static type = 'align'
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
			this.editor.alignShapes(
				action.shapeIds.map((id) => `shape:${id}`),
				action.alignment,
			)
		}
	},
)
