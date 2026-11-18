/**
 * Gives each agent what pi reads in its folder before it starts, AGENTS.md and skills, found on the runner before every request,
 * and, as pi does, the folder itself, so paths and commands start there.
 * A person's message that starts `/skill:name` reaches the agent as that skill's file, then the rest of the message, as in pi;
 * `GET /api/context?runner=&dir=` lists the skills a runner's folder has, by name and description.
 * On by default; MODULES=-context turns it off.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
	DefaultResourceLoader,
	stripFrontmatter,
	formatSkillsForPrompt,
	getAgentDir,
	SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { defineExtension } from '@earendil-works/pi-durable'
import { within } from '../remote.js'

export const on = true

export function server({ runners, known, reach }) {
	const section = {
		key: 'project',
		tag: false,
		render: async ({ env }, context) => {
			const runner = env?.id?.replace(/^runner:/, '')
			if (!runner) return undefined
			const found = await runners.call(
				runner,
				{ op: 'context', dir: env.cwd },
				{ signal: context.abortSignal },
			)
			const folder = `<cwd>\n${env.cwd}\n</cwd>`
			return found ? `${found}\n\n${folder}` : folder
		},
	}
	/** The skills a runner's folder has, `{skills: [{name, description}]}`, for whoever may work there */
	async function serve(threadId, query, body, by) {
		if (threadId !== undefined || body !== undefined)
			throw new Error('GET /api/context?runner=&dir= lists the skills in a folder')
		const name = query.get('runner')
		const runner = name && (await known())[name]
		if (!runner) throw new Error(`No runner named ${name}`)
		reach([{ runner: name }], by, await known())
		if (!runners.isOnline(name)) throw new Error(`${name} is offline`)
		const dir = path.resolve(runner.dir, query.get('dir') || '.')
		return { skills: await runners.call(name, { op: 'context', dir, skills: true }, {}) }
	}
	/** A message starting `/skill:name` as pi expands it, on the agent's runner and in its folder; otherwise as it was; the thread keeps the message as typed, and an unknown skill name goes as typed */
	async function expand(text, runner, dir, signal) {
		if (!text.startsWith('/skill:')) return text
		return (await runners.call(runner, { op: 'context', dir, expand: text }, { signal })) ?? text
	}
	return {
		serve,
		expand,
		extension: defineExtension({ name: 'ade.context', sections: [section] }),
	}
}

/** Skill files can sit outside the runner's folder, so the skills it lists are readable wherever they live */
export function runner(core) {
	const listed = new Set()
	async function context({ dir, skills: list, expand }) {
		if (!within(core.roots ?? [core.dir], path.resolve(dir)))
			throw new Error(`${dir} is outside ${core.name}'s folders`)
		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir: getAgentDir(),
			settingsManager: SettingsManager.create(dir),
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
		})
		await loader.reload()
		const all = loader.getSkills().skills
		if (list) return all.map(({ name, description }) => ({ name, description }))
		if (expand !== undefined) return skillCommand(expand, all, listed)
		const files = loader
			.getAgentsFiles()
			.agentsFiles.map(
				({ path, content }) =>
					`<project_instructions path="${path}">\n${content}\n</project_instructions>`,
			)
		const shown = loader.getSkills().skills.filter((skill) => !skill.disableModelInvocation)
		for (const skill of shown) listed.add(path.resolve(skill.baseDir))
		const skills = formatSkillsForPrompt(shown).trim()
		const parts = [
			files.length &&
				`<project_context>\nProject-specific instructions and guidelines:\n\n${files.join('\n\n')}\n</project_context>`,
			skills && `<skills>\n${skills}\n</skills>`,
		]
		return parts.filter(Boolean).join('\n\n') || null
	}
	return { call: context, readable: () => [...listed] }
}

/** Pi's own expansion of `/skill:name args`: the skill's file in a <skill> block, then the args; null for no such skill */
async function skillCommand(text, skills, listed) {
	const space = text.indexOf(' ')
	const name = space === -1 ? text.slice(7) : text.slice(7, space)
	const args = space === -1 ? '' : text.slice(space + 1).trim()
	const skill = skills.find((skill) => skill.name === name)
	if (!skill) return null
	const body = stripFrontmatter(await readFile(skill.filePath, 'utf8')).trim()
	listed.add(path.resolve(skill.baseDir))
	const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
	return args ? `${block}\n\n${args}` : block
}
