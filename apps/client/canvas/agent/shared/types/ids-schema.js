import z from '../../../zod.js'
export const SimpleShapeIdSchema = z.string().brand('simpleShapeId')
export const TldrawShapeIdSchema = z.string().brand('tldrawShapeId')
export function toTldrawShapeId(id) {
	return `shape:${id}`
}
export function toSimpleShapeId(id) {
	if (id.startsWith('shape:')) throw new Error('Invalid simple shape id')
	return id
}
export const TodoIdSchema = z.number().brand('todoId')
