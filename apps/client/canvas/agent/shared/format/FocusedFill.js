import z from '../../../zod.js'
export const FocusedFillSchema = z.enum(['none', 'tint', 'background', 'solid', 'pattern'])
const FOCUSED_TO_SHAPE_FILLS = {
	none: 'none',
	solid: 'lined-fill',
	background: 'semi',
	tint: 'solid',
	pattern: 'pattern',
}
const SHAPE_TO_FOCUSED_FILLS = {
	none: 'none',
	fill: 'solid',
	'lined-fill': 'solid',
	semi: 'background',
	solid: 'tint',
	pattern: 'pattern',
}
export function convertFocusedFillToTldrawFill(fill) {
	return FOCUSED_TO_SHAPE_FILLS[fill]
}
export function convertTldrawFillToFocusedFill(fill) {
	return SHAPE_TO_FOCUSED_FILLS[fill]
}
