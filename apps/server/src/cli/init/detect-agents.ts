import { join } from 'node:path';
import type { SkillAgent } from '../skill/skills-folder.js';

/** What tells that an agent is used on this machine; injected so a test owns the machine. */
export interface AgentProbe {
	homeDirectory: string;
	hasCommand: (name: string) => boolean;
	hasFolder: (path: string) => boolean;
}

/** The signs of each agent: a command on the PATH, or a folder it keeps in the home directory. */
const SIGNS: Record<SkillAgent, { commands: readonly string[]; folders: readonly string[] }> = {
	claude: { commands: ['claude'], folders: ['.claude'] },
	agents: { commands: ['codex', 'opencode'], folders: ['.agents', '.codex'] }
};

/** Who each skills folder is for, as a person reads it. */
export const AGENT_NAMES: Record<SkillAgent, string> = {
	claude: 'Claude Code',
	agents: 'Codex, OpenCode and others'
};

/** The agents found on this machine. With none found the skill goes to Claude Code, the most common one. */
export function detectAgents(probe: AgentProbe): SkillAgent[] {
	const found = (Object.keys(SIGNS) as SkillAgent[]).filter((agent) => isPresent(agent, probe));

	return found.length > 0 ? found : ['claude'];
}

function isPresent(agent: SkillAgent, probe: AgentProbe): boolean {
	const { commands, folders } = SIGNS[agent];

	return (
		commands.some((command) => probe.hasCommand(command)) ||
		folders.some((folder) => probe.hasFolder(join(probe.homeDirectory, folder)))
	);
}
