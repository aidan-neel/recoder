import { usageError } from '../exit.js';
import type { InitRequest, InitScope } from '../init/init-request.js';
import { SKILL_AGENTS, type SkillAgent } from '../skill/skills-folder.js';
import { INIT_FLAGS } from './flags.js';
import { rejectMoreThanOne, splitList } from './lists.js';
import { parseFlags } from './parse.js';
import { parseChoice, parseText } from './values.js';

/** Reads the flags of `recoder init`. Throws a `CliError` for a bad one or a combination that means nothing. */
export function parseInitArgs(argv: string[]): InitRequest {
	const values = parseFlags(argv, { options: INIT_FLAGS, strict: true, allowPositionals: false });

	rejectMoreThanOne(values, ['project', 'global']);

	return {
		scope: scopeOf(values),
		agents: parseAgents(values.agent),
		reviewer: parseText('--reviewer', values.reviewer),
		mcp: values.mcp === true,
		guidelines: values['no-guidelines'] !== true,
		force: values.force === true,
		assumeDefaults: values.yes === true
	};
}

function scopeOf(values: { project?: boolean; global?: boolean }): InitScope | null {
	if (values.project !== undefined) return 'project';

	return values.global === undefined ? null : 'global';
}

function parseAgents(values: string[] | undefined): SkillAgent[] | null {
	if (values === undefined) return null;

	const agents = splitList(values).map((agent) => parseChoice('--agent', agent, SKILL_AGENTS));

	if (agents.length === 0) throw usageError(`--agent needs at least one of ${SKILL_AGENTS.join(', ')}.`);

	return agents;
}
