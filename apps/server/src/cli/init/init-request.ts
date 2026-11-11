import type { SkillAgent } from '../skill/skills-folder.js';

/** Where `recoder init` sets Recoder up: this folder, or this machine. */
export type InitScope = 'project' | 'global';

/** One `recoder init`, as its flags asked for it. What a flag left open is decided when the command runs. */
export interface InitRequest {
	/** Null asks on a terminal. */
	scope: InitScope | null;
	/** The agents whose skills folder gets the skill; null is the agents found on this machine. */
	agents: SkillAgent[] | null;
	/** The model id to save as the review model; null keeps the saved one, or asks when there is none. */
	reviewer: string | null;
	/** Whether to add the MCP server to the project's `.mcp.json`. */
	mcp: boolean;
	/** Whether a project gets a `RECODER.md` when it has none. */
	guidelines: boolean;
	/** Replace an installed skill or MCP entry that differs. */
	force: boolean;
	/** Ask nothing and take the defaults. */
	assumeDefaults: boolean;
}
