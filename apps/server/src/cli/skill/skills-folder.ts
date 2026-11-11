import { isAbsolute, join, resolve } from 'node:path';
import { notReadyError } from '../exit.js';

/** The agents whose skills folder is known. Any other agent takes `--dir`. */
export const SKILL_AGENTS = ['claude', 'agents'] as const;

export const SKILL_SCOPES = ['user', 'project'] as const;

export type SkillAgent = (typeof SKILL_AGENTS)[number];

export type SkillScope = (typeof SKILL_SCOPES)[number];

/** Where a skills folder sits, relative to the home directory or to the project. */
const AGENT_FOLDERS = {
	claude: join('.claude', 'skills'),
	agents: join('.agents', 'skills')
} as const satisfies Record<SkillAgent, string>;

/** What the caller chose: an explicit folder, or an agent and a scope. */
interface SkillsFolderChoice {
	agent: SkillAgent;
	scope: SkillScope;
	/** Replaces the agent and scope when given. */
	dir: string | null;
}

/** The directories a relative or home-based folder is measured from. */
interface FolderRoots {
	workingDirectory: string;
	homeDirectory: string;
}

/**
 * The absolute skills folder for a choice. An explicit `dir` is measured from the working directory. A home directory
 * that is not absolute (`HOME=.`, or unset on some systems) is refused: the skill would land beside whatever folder
 * the command ran in.
 */
export function resolveSkillsFolder(choice: SkillsFolderChoice, roots: FolderRoots): string {
	if (choice.dir !== null) return resolve(roots.workingDirectory, choice.dir);

	if (choice.scope === 'project') return join(roots.workingDirectory, AGENT_FOLDERS[choice.agent]);

	if (!isAbsolute(roots.homeDirectory)) {
		throw notReadyError(`the home directory "${roots.homeDirectory}" is not an absolute path; pass --dir <folder>.`);
	}

	return join(roots.homeDirectory, AGENT_FOLDERS[choice.agent]);
}
