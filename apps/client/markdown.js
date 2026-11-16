/**
 * A message's markdown as HTML. Raw HTML in it shows as written, and links go only to the web or mail.
 * A thread mentioned as `@"its title"` becomes a link to it when `threadLink(title)` knows it; the longest known title wins.
 */
import { marked } from 'marked'

const escape = (text) =>
	text.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
	)
const SAFE = /^(https?:|mailto:|#|\/(?!\/))/i

/** How a picked thread goes into a message: its title, quoted so the agent reads where it ends */
export const threadMention = (title) => `@"${title}"`

marked.use({
	gfm: true,
	extensions: [
		{
			name: 'threadMention',
			level: 'inline',
			start: (src) => src.indexOf('@"'),
			tokenizer(src) {
				if (!src.startsWith('@"')) return
				const line = src.split('\n', 1)[0]
				for (
					let close = line.lastIndexOf('"');
					close > 1;
					close = line.lastIndexOf('"', close - 1)
				) {
					const link = this.lexer.options.threadLink?.(line.slice(2, close))
					if (link) return { type: 'threadMention', raw: line.slice(0, close + 1), ...link }
				}
			},
			renderer: ({ href, id, title }) =>
				`<a class="thread-link" href="${escape(href)}" data-thread="${id}">${escape(title)}</a>`,
		},
	],
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

export const markdown = (text, threadLink) => marked.parse(text ?? '', { async: false, threadLink })
