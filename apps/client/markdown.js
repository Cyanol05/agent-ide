/** A message's markdown as safe HTML: marked writes it, DOMPurify strips anything that could run. */
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.use({ gfm: true, breaks: true })

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName !== 'A') return
	node.setAttribute('target', '_blank')
	node.setAttribute('rel', 'noopener noreferrer')
})

export const markdown = (text) => DOMPurify.sanitize(marked.parse(text ?? '', { async: false }))
