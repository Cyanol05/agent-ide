import z from '../../../zod.js'
export const FocusedColor = z.enum([
	'red',
	'light-red',
	'green',
	'light-green',
	'blue',
	'light-blue',
	'orange',
	'yellow',
	'black',
	'violet',
	'light-violet',
	'grey',
	'white',
])
export function asColor(color) {
	if (FocusedColor.safeParse(color).success) {
		return color
	}
	switch (color) {
		case 'pink': {
			return 'light-violet'
		}
		case 'light-pink': {
			return 'light-violet'
		}
	}
	return 'black'
}
