import { z } from '../../../zod.js'
import { SimpleShapeIdSchema } from '../types/ids-schema.js'
import { FocusedColor } from './FocusedColor.js'
import { FocusedFillSchema } from './FocusedFill.js'
import { FocusedFontSize } from './FocusedFontSize.js'
import { FocusedGeoShapeTypeSchema } from './FocusedGeoShapeType.js'
const FocusedLabel = z.string()
export const FocusedTextAnchorSchema = z.enum([
	'bottom-center',
	'bottom-left',
	'bottom-right',
	'center-left',
	'center-right',
	'center',
	'top-center',
	'top-left',
	'top-right',
])
export const FocusedGeoShape = z.object({
	_type: FocusedGeoShapeTypeSchema,
	color: FocusedColor,
	fill: FocusedFillSchema,
	h: z.number(),
	note: z.string(),
	shapeId: SimpleShapeIdSchema,
	text: FocusedLabel.optional(),
	textAlign: z.enum(['start', 'middle', 'end']).optional(),
	w: z.number(),
	x: z.number(),
	y: z.number(),
})
export const FocusedGeoShapePartialSchema = FocusedGeoShape.partial()
const FocusedLineShape = z.object({
	_type: z.literal('line'),
	color: FocusedColor,
	note: z.string(),
	shapeId: SimpleShapeIdSchema,
	x1: z.number(),
	x2: z.number(),
	y1: z.number(),
	y2: z.number(),
})
const FocusedNoteShape = z.object({
	_type: z.literal('note'),
	color: FocusedColor,
	note: z.string(),
	shapeId: SimpleShapeIdSchema,
	text: FocusedLabel.optional(),
	x: z.number(),
	y: z.number(),
})
const FocusedTextShape = z
	.object({
		_type: z.literal('text'),
		anchor: FocusedTextAnchorSchema,
		color: FocusedColor,
		fontSize: FocusedFontSize.optional(),
		maxWidth: z.number().nullable(),
		note: z.string(),
		shapeId: SimpleShapeIdSchema,
		text: FocusedLabel,
		x: z.number(),
		y: z.number(),
	})
	.meta({
		title: 'Text Shape',
		description:
			'A text shape is a shape that contains text. The `anchor` property indicates how the text shape is positioned and aligned. For example, the "top-left" anchor means the text shape\'s x and y coordinates are the top left corner of the text shape, and the text gets left aligned. A shape with the "bottom-center" anchor means the text shape\'s x and y coordinates are the bottom center of the text shape, and the text gets center aligned on the horizontal axis. By default, text shapes auto-size to fit their content. If you provide a `maxWidth`, the text will automatically wrap to the next line if it exceeds that width (there is no need to add manual line breaks for word wrapping).',
	})
export const FocusedTextShapePartialSchema = FocusedTextShape.partial()
const FocusedArrowShape = z.object({
	_type: z.literal('arrow'),
	color: FocusedColor,
	fromId: SimpleShapeIdSchema.nullable(),
	note: z.string(),
	shapeId: SimpleShapeIdSchema,
	text: z.string().optional(),
	toId: SimpleShapeIdSchema.nullable(),
	x1: z.number(),
	x2: z.number(),
	y1: z.number(),
	y2: z.number(),
	bend: z.number().optional(),
})
const FocusedDrawShape = z
	.object({
		_type: z.literal('draw'),
		color: FocusedColor,
		fill: FocusedFillSchema.optional(),
		note: z.string(),
		shapeId: SimpleShapeIdSchema,
	})
	.meta({
		title: 'Draw Shape',
		description:
			'A draw shape is a freeform shape that was drawn by the pen tool. IMPORTANT: Do not create draw shapes with the "create" action. To create new draw shapes, the AI must use the pen event because it gives more control.',
	})
const FocusedUnknownShape = z
	.object({
		_type: z.literal('unknown'),
		note: z.string(),
		shapeId: SimpleShapeIdSchema,
		subType: z.string(),
		x: z.number(),
		y: z.number(),
	})
	.meta({
		title: 'Unknown Shape',
		description:
			"A special shape that is not represented by one of the canvas's core shape types. The AI cannot create these shapes, but it *can* interact with them. eg: The AI can move these shapes. The `subType` property contains the internal name of the shape's type.",
	})
const FOCUSED_SHAPES = [
	FocusedDrawShape,
	FocusedGeoShape,
	FocusedLineShape,
	FocusedTextShape,
	FocusedArrowShape,
	FocusedNoteShape,
	FocusedUnknownShape,
]
export const FocusedShapeSchema = z.union(FOCUSED_SHAPES)
/**
 * Extract all shape type names from the schema
 */
export function getFocusedShapeSchemaNames() {
	const typeNames = []
	for (const shapeSchema of FOCUSED_SHAPES) {
		const typeField = shapeSchema.shape._type
		if (typeField) {
			// Handle ZodLiterals (like FocusedDrawShape)
			if ('value' in typeField && typeof typeField.value === 'string') {
				typeNames.push(typeField.value)
			}
			// Handle ZodEnums (like FocusedGeoShape)
			else if ('options' in typeField && Array.isArray(typeField.options)) {
				typeNames.push(...typeField.options)
			}
		}
	}
	return typeNames
}
