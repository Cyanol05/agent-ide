import {
	convertTldrawIdToSimpleId,
	convertTldrawShapeToFocusedType,
} from './convertTldrawShapeToFocusedShape.js'
/**
 * Convert a tldraw shape to the blurry shape format
 */
export function convertTldrawShapeToBlurryShape(editor, shape) {
	const bounds = editor.getShapeMaskedPageBounds(shape)
	if (!bounds) return null
	const util = editor.getShapeUtil(shape)
	const text = util.getText(shape)
	const shapeType = convertTldrawShapeToFocusedType(shape)
	return {
		x: Math.round(bounds.x),
		y: Math.round(bounds.y),
		w: Math.round(bounds.w),
		h: Math.round(bounds.h),
		type: shapeType,
		shapeId: convertTldrawIdToSimpleId(shape.id),
		text,
	}
}
