import { createShapeId, getDisplayValues } from '../../../tldraw.js'
import { z } from '../../../zod.js'
const TEXT_SIZE_STYLES = ['s', 'm', 'l', 'xl']
export const FocusedFontSize = z.number()
/**
 * Calculates the closest predefined font size and scale combination to achieve a target font size
 * @param editor - The tldraw editor instance
 * @param targetFontSize - The desired font size in pixels
 * @param textProps - The text shape props to use when resolving display values
 * @returns An object containing the closest predefined font size key and the scale factor
 */
export function convertFocusedFontSizeToTldrawFontSizeAndScale(editor, targetFontSize, textProps) {
	const fontSizeEntries = TEXT_SIZE_STYLES.map((size) => [
		size,
		getTextShapeDisplayFontSize(editor, { ...textProps, size }),
	])
	let closestSize = fontSizeEntries[0]
	let closestPixelSize = closestSize[1]
	let minDifference = Math.abs(targetFontSize - closestPixelSize)
	for (const [size, pixelSize] of fontSizeEntries) {
		const difference = Math.abs(targetFontSize - pixelSize)
		if (difference < minDifference) {
			minDifference = difference
			closestSize = [size, pixelSize]
			closestPixelSize = pixelSize
		}
	}
	const textSize = closestSize[0]
	const scale = targetFontSize / closestPixelSize
	return { textSize, scale }
}
/**
 * Converts a tldraw font size and scale to a focused font size
 * @param editor - The tldraw editor instance
 * @param shape - The text shape to convert
 * @returns The focused font size
 */
export function convertTldrawFontSizeAndScaleToFocusedFontSize(editor, shape) {
	const util = editor.getShapeUtil('text')
	const displayValues = getDisplayValues(util, shape)
	return Math.round(displayValues.fontSize * shape.props.scale)
}
function getTextShapeDisplayFontSize(editor, textProps) {
	const util = editor.getShapeUtil('text')
	const shape = {
		id: createShapeId('agent-font-size'),
		typeName: 'shape',
		type: 'text',
		x: 0,
		y: 0,
		rotation: 0,
		index: 'a1',
		parentId: editor.getCurrentPageId(),
		isLocked: false,
		opacity: 1,
		props: {
			...util.getDefaultProps(),
			...textProps,
		},
		meta: {},
	}
	return getDisplayValues(util, shape).fontSize
}
