/** The temporary title for a new message, until someone names its thread. */
export const defaultTitle = (body) => body.trim().slice(0, 60).trim() || 'An image'
