/**
 * A message's markdown as HTML. Raw HTML in it shows as written, and links go only to the web or mail.
 * A thread mentioned as `@"its title"` becomes a link to it when `links.threadLink(title)` knows it; the longest known title wins.
 * A bot mentioned as `@name` shows in its colour when `links.botColor(name)` gives one, the style its name has everywhere else.
 */
import { marked } from 'marked'

/** @typedef {import('marked').MarkedOptions & { threadLink?: (title: string) => { href: string, id: number, title: string }, botColor?: (name: string) => string }} LinkOptions */

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
					const link = /** @type {LinkOptions} */ (this.lexer.options).threadLink?.(
						line.slice(2, close),
					)
					if (link) return { type: 'threadMention', raw: line.slice(0, close + 1), ...link }
				}
			},
			renderer: ({ href, id, title }) =>
				`<a class="thread-link" href="${escape(href)}" data-thread="${id}">${escape(title)}</a>`,
		},
		{
			name: 'botMention',
			level: 'inline',
			// Only an @ that starts a word, so an email address stays one
			start: (src) => src.match(/(?<![\w.@])@[\w]/)?.index,
			tokenizer(src) {
				const name = src.match(/^@([\w.-]+)/)?.[1].replace(/\.+$/, '')
				const style = name && /** @type {LinkOptions} */ (this.lexer.options).botColor?.(name)
				if (style) return { type: 'botMention', raw: `@${name}`, name, style }
			},
			renderer: ({ name, style }) =>
				`<span class="mention" style="${escape(style)}">@${escape(name)}</span>`,
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

export const markdown = (text, links = {}) => marked.parse(text ?? '', { async: false, ...links })
