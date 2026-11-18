import { Box, getArrowBindings, intersectPolygonPolygon } from '../../../../tldraw.js'
import { convertTldrawIdToSimpleId } from '../../../shared/format/convertTldrawShapeToFocusedShape.js'
import { BaseAgentManager } from './BaseAgentManager.js'
/**
 * Generate a unique key for a lint based on its type and shape IDs.
 */
function getLintKey(lint) {
	const sortedIds = [...lint.shapeIds].sort().join(',')
	return `${lint.type}:${sortedIds}`
}
/**
 * Tracks shapes created by the agent during a prompt chain and computes lints on them.
 * This is cleared when starting a new top-level prompt (not nested prompts).
 */
export class AgentLintManager extends BaseAgentManager {
	/**
	 * Set of shape IDs created during the current prompt chain.
	 * Persists across nested prompts but clears when a new top-level prompt starts.
	 */
	createdShapeIds = new Set()
	/**
	 * Set of lint keys that have already been surfaced to the agent.
	 * These won't be shown again in subsequent prompts.
	 */
	surfacedLintKeys = new Set()
	/**
	 * Reset the lint manager to its initial state.
	 */
	reset() {
		this.createdShapeIds.clear()
		this.surfacedLintKeys.clear()
	}
	/**
	 * Clear tracking of created shapes (called at start of new prompt chain).
	 * Also clears surfaced lints since we're starting fresh.
	 */
	clearCreatedShapes() {
		this.createdShapeIds.clear()
		this.surfacedLintKeys.clear()
	}
	/**
	 * Track shapes created from a diff.
	 * Should be called after each action is applied.
	 */
	trackShapesFromDiff(diff) {
		for (const [id, record] of Object.entries(diff.added)) {
			if (record.typeName === 'shape') {
				this.createdShapeIds.add(id)
			}
		}
		// Track removed shapes and remove from created set
		for (const id of Object.keys(diff.removed)) {
			this.createdShapeIds.delete(id)
		}
	}
	/**
	 * Get all shape IDs created during the current prompt chain.
	 */
	getCreatedShapeIds() {
		return Array.from(this.createdShapeIds)
	}
	/**
	 * Get shapes created during the prompt chain that still exist.
	 */
	getCreatedShapes() {
		const { editor } = this.agent
		return this.getCreatedShapeIds()
			.map((id) => editor.getShape(id))
			.filter((shape) => shape !== undefined)
	}
	/**
	 * Unlock all shapes created during the current prompt chain.
	 * Called when the prompt completes to make shapes editable again.
	 */
	unlockCreatedShapes() {
		const { editor } = this.agent
		const createdShapes = this.getCreatedShapes()
		const lockedShapes = createdShapes.filter((shape) => shape.isLocked)
		if (lockedShapes.length === 0) return
		editor.run(
			() => {
				for (const shape of lockedShapes) {
					editor.updateShape({ id: shape.id, type: shape.type, isLocked: false })
				}
			},
			{ ignoreShapeLock: true, history: 'ignore' },
		)
	}
	/**
	 * Check if there are any unsurfaced lints for the given shapes.
	 */
	hasUnsurfacedLints(shapes) {
		return this.getUnsurfacedLintsForShapes(shapes).length > 0
	}
	/**
	 * Get unsurfaced lints for a specific set of shapes.
	 */
	getUnsurfacedLintsForShapes(shapes) {
		const lints = this.detectCanvasLints(shapes)
		return lints.filter((lint) => !this.surfacedLintKeys.has(getLintKey(lint)))
	}
	/**
	 * Mark the given lints as surfaced.
	 * Call this when scheduling a lint-fixing prompt.
	 */
	markLintsAsSurfaced(lints) {
		for (const lint of lints) {
			this.surfacedLintKeys.add(getLintKey(lint))
		}
	}
	// ============================================================================
	// Lint Detection Functions
	// ============================================================================
	/**
	 * Detect all canvas lints on a set of shapes.
	 */
	detectCanvasLints(shapes) {
		const lints = []
		// Collect shapes for each lint type
		const growYShapes = this.getShapesWithGrowY(shapes)
		const overlappingTextGroups = this.getOverlappingTextGroups(shapes)
		const friendlessArrows = this.getFriendlessArrows(shapes)
		// Convert shapes to lints (converting shape IDs to strings)
		for (const shape of growYShapes) {
			lints.push({
				type: 'growY-on-shape',
				shapeIds: [convertTldrawIdToSimpleId(shape.id)],
			})
		}
		for (const group of overlappingTextGroups) {
			lints.push({
				type: 'overlapping-text',
				shapeIds: group.map((shape) => convertTldrawIdToSimpleId(shape.id)),
			})
		}
		for (const arrow of friendlessArrows) {
			lints.push({
				type: 'friendless-arrow',
				shapeIds: [convertTldrawIdToSimpleId(arrow.id)],
			})
		}
		return lints
	}
	/**
	 * Get shapes that grew to fit their text (growY > 0) and now overlap another shape; arrows don't count, since they
	 * touch what they join.
	 */
	getShapesWithGrowY(shapes) {
		const others = shapes.filter((shape) => shape.type !== 'arrow')
		return shapes.filter(
			(shape) =>
				shape.props.growY > 5 && // use 5 because 0 flags shapes that don't need to be changed
				others.some((other) => other.id !== shape.id && this.shapesOverlap(shape, other)),
		)
	}
	/**
	 * Get groups of shapes with overlapping text.
	 */
	getOverlappingTextGroups(shapes) {
		const { editor } = this.agent
		const groups = []
		const shapesWithText = shapes.filter((shape) => {
			// Exclude arrows from overlapping text detection
			if (shape.type === 'arrow') return false
			const util = editor.getShapeUtil(shape)
			const text = util.getText(shape)
			return text !== undefined && text.length > 0
		})
		if (shapesWithText.length < 2) {
			return groups
		}
		// Use union-find to group overlapping shapes
		const parent = new Map()
		const find = (shape) => {
			if (!parent.has(shape)) {
				parent.set(shape, shape)
			}
			const p = parent.get(shape)
			if (p !== shape) {
				parent.set(shape, find(p))
			}
			return parent.get(shape)
		}
		const union = (shapeA, shapeB) => {
			const rootA = find(shapeA)
			const rootB = find(shapeB)
			if (rootA !== rootB) {
				parent.set(rootB, rootA)
			}
		}
		// Check all pairs for overlaps using geometry-based detection
		for (let i = 0; i < shapesWithText.length; i++) {
			const shapeA = shapesWithText[i]
			for (let j = i + 1; j < shapesWithText.length; j++) {
				const shapeB = shapesWithText[j]
				if (this.shapesOverlap(shapeA, shapeB)) {
					union(shapeA, shapeB)
				}
			}
		}
		// Group shapes by their root
		const rootGroups = new Map()
		for (const shape of shapesWithText) {
			const root = find(shape)
			if (!rootGroups.has(root)) {
				rootGroups.set(root, [])
			}
			rootGroups.get(root).push(shape)
		}
		// Collect groups with 2+ shapes (overlapping)
		for (const [, group] of rootGroups) {
			if (group.length >= 2) {
				groups.push(group)
			}
		}
		return groups
	}
	/**
	 * Get arrows that are not connected to anything.
	 */
	getFriendlessArrows(shapes) {
		const { editor } = this.agent
		const arrowShapes = shapes.filter((shape) => shape.type === 'arrow')
		const friendlessArrows = arrowShapes.filter((arrow) => {
			const bindings = getArrowBindings(editor, arrow)
			// An arrow is "friendless" if it has no start or end binding
			return !bindings.start || !bindings.end
		})
		return friendlessArrows
	}
	// ============================================================================
	// Helper Functions
	// ============================================================================
	/**
	 * Check if two shapes overlap using geometry-based detection.
	 */
	shapesOverlap(shapeA, shapeB) {
		const { editor } = this.agent
		// Quick bounds check first for early exit
		const boundsA = editor.getShapePageBounds(shapeA)
		const boundsB = editor.getShapePageBounds(shapeB)
		if (!boundsA || !boundsB || !Box.Collides(boundsA, boundsB)) {
			return false
		}
		// Get geometry and transform for shape A
		const geometryA = editor.getShapeGeometry(shapeA)
		const pageTransformA = editor.getShapePageTransform(shapeA)
		const verticesA = pageTransformA.applyToPoints(geometryA.vertices)
		// Get clip path if it exists
		const shapeUtilA = editor.getShapeUtil(shapeA.type)
		const clipPathA = shapeUtilA.getClipPath?.(shapeA)
		const polygonA = clipPathA
			? intersectPolygonPolygon(pageTransformA.applyToPoints(clipPathA), verticesA)
			: verticesA
		if (!polygonA || polygonA.length === 0) {
			return false
		}
		// Transform polygon A into shape B's local space
		const pageTransformB = editor.getShapePageTransform(shapeB)
		const polygonAInShapeBSpace = pageTransformB.clone().invert().applyToPoints(polygonA)
		// Check if shape B's geometry overlaps with the transformed polygon
		const geometryB = editor.getShapeGeometry(shapeB)
		return geometryB.overlapsPolygon(polygonAInShapeBSpace)
	}
}
