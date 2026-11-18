// Browser-only CDN modules have no locally installed declarations.
/* oxlint-disable typescript/no-explicit-any -- Types stop at this CDN import boundary. */
declare module 'https://esm.sh/tldraw@*' {
	export const allDefaultFontFaces: any
	export const b64Vecs: any
	export const Box: any
	export const createShapeId: any
	export const FileHelpers: any
	export const getArrowBindings: any
	export const getDisplayValues: any
	export const intersectPolygonPolygon: any
	export const isPageId: any
	export const reverseRecordsDiff: any
	export const toRichText: any
	export const Vec: any
}
declare module 'https://esm.sh/zod@*' {
	export const z: any
	export default z
}
declare module 'https://esm.sh/diff@*' {
	export function diffWords(
		before: string,
		after: string,
	): Array<{ added?: boolean; removed?: boolean; value: string }>
}
