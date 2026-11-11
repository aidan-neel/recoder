import { join } from 'node:path';
import { describeError } from '../exit.js';
import { BUNDLED_SKILL, SKILL_FOLDER_NAME } from '../skill/bundled-skill.js';
import { installSkill } from '../skill/install-skill.js';
import { readSkillState } from '../skill/skill-state.js';
import type { SkillAgent } from '../skill/skills-folder.js';
import { AGENT_NAMES } from './detect-agents.js';
import { failedStep, type InitStep } from './init-step.js';

/** Where one agent's skill goes, and who decides whether a skill that differs is replaced. */
export interface SkillInstallPlan {
	agent: SkillAgent;
	/** The agent's skills folder in the chosen scope. */
	skillsFolder: string;
	/** Asked only when a skill that differs from this version is already there. */
	shouldReplace: (destination: string) => Promise<boolean>;
}

/**
 * Puts this version of the skill in one agent's skills folder: installs it where there is none, leaves one that is
 * already this version, and replaces one that differs only when `shouldReplace` agrees. A folder that cannot be
 * written, or a destination that is a symbolic link, fails the step and leaves the others to run.
 */
export async function installSkillStep(plan: SkillInstallPlan): Promise<InitStep> {
	const destination = join(plan.skillsFolder, SKILL_FOLDER_NAME);
	const step = { id: 'skill', label: 'Skill', path: destination } as const;
	const who = `for ${AGENT_NAMES[plan.agent]}`;

	try {
		const state = await readSkillState(plan.skillsFolder, BUNDLED_SKILL);

		if (state === 'current') return { ...step, state: 'unchanged', detail: `up to date ${who}`, fix: null };

		if (state === 'different' && !(await plan.shouldReplace(destination))) {
			return {
				...step,
				state: 'skipped',
				detail: `an older or edited skill is there ${who}`,
				fix: 'Run recoder init again with --force to replace it.'
			};
		}

		await installSkill({ source: BUNDLED_SKILL, skillsFolder: plan.skillsFolder, force: state === 'different' });

		return { ...step, state: 'done', detail: `${state === 'different' ? 'updated' : 'installed'} ${who}`, fix: null };
	} catch (error) {
		return failedStep(step, describeError(error));
	}
}
