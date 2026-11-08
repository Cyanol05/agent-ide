/** A picked, pasted or dropped image as pi takes it: ImageContent, inside pi's limits of 2000×2000 and 4.5 MB of base64. */
const SIDE = 2000
const BYTES = 4.5 * 1024 * 1024
const AS_IS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

const base64 = (blob) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result).split(',')[1])
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})

export async function imageContent(file) {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
		throw new Error(`${file.name || 'That file'} isn't an image this browser can read`)
	})
	const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height))
	if (scale === 1 && AS_IS.includes(file.type) && (file.size * 4) / 3 < BYTES) {
		bitmap.close()
		return { type: 'image', mimeType: file.type, data: await base64(file) }
	}
	const canvas = new OffscreenCanvas(
		Math.round(bitmap.width * scale),
		Math.round(bitmap.height * scale),
	)
	canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
	bitmap.close()
	for (const quality of [0.9, 0.75, 0.6]) {
		const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
		if ((blob.size * 4) / 3 < BYTES)
			return { type: 'image', mimeType: blob.type, data: await base64(blob) }
	}
	throw new Error(`${file.name || 'That image'} is too big to send, even shrunk`)
}

export const imageUrl = (image) => `data:${image.mimeType};base64,${image.data}`
