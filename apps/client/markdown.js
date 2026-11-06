/** A message's markdown as HTML. Raw HTML in it shows as written, and links go only to the web or mail. */
import { marked } from 'marked'

const escape = (text) =>
	text.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
	)
const SAFE = /^(https?:|mailto:|#|\/(?!\/))/i

marked.use({
	gfm: true,
	breaks: true,
	renderer: {
		html: ({ text, block }) => (block ? `<p>${escape(text.trim())}</p>\n` : escape(text)),
		link({ href, title, tokens }) {
			const label = this.parser.parseInline(tokens)
			if (!SAFE.test(href.trim())) return label
			return `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`
		},
		image: ({ href, text }) =>
			/^https?:/i.test(href.trim())
				? `<img src="${escape(href)}" alt="${escape(text)}">`
				: escape(text),
	},
})

export const markdown = (text) => marked.parse(text ?? '', { async: false })
