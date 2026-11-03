/**
 * Gives each agent what pi reads in its folder before it starts, AGENTS.md and skills, found on the runner before every request.
 * On by default; MODULES=-context turns it off.
 */
import path from 'node:path'
import {
	DefaultResourceLoader,
	formatSkillsForPrompt,
	getAgentDir,
	SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { defineExtension } from '@earendil-works/pi-durable'
import { within } from '../remote.js'

export function server({ runners }) {
	const section = {
		key: 'project',
		tag: false,
		render: async ({ env }, context) => {
			const runner = env?.id?.replace(/^runner:/, '')
			if (!runner) return undefined
			return (
				(await runners.call(
					runner,
					{ op: 'context', dir: env.cwd },
					{ signal: context.abortSignal },
				)) ?? undefined
			)
		},
	}
	return { extension: defineExtension({ name: 'agent-ide.context', sections: [section] }) }
}

/** Skill files can sit outside the runner's folder, where the file tools don't reach, so agents read them with bash */
export function runner(core) {
	async function context({ dir }) {
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
		const files = loader
			.getAgentsFiles()
			.agentsFiles.map(
				({ path, content }) =>
					`<project_instructions path="${path}">\n${content}\n</project_instructions>`,
			)
		const skills = formatSkillsForPrompt(loader.getSkills().skills, 'bash').trim()
		const parts = [
			files.length &&
				`<project_context>\nProject-specific instructions and guidelines:\n\n${files.join('\n\n')}\n</project_context>`,
			skills && `<skills>\n${skills}\n</skills>`,
		]
		return parts.filter(Boolean).join('\n\n') || null
	}
	return { call: context }
}
