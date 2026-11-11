import reference from '../../../skills/recoder/reference.md' with { type: 'text' };
import skill from '../../../skills/recoder/SKILL.md' with { type: 'text' };

/** The folder name the skill is installed under, and the `name` in its `SKILL.md`. */
export const SKILL_FOLDER_NAME = 'recoder';

/** One file of a skill: its path inside the skill folder, and its text. */
export interface SkillFile {
	path: string;
	text: string;
}

/**
 * The skill that ships with the program. It is built into the program, so the `recoder`
 * binary needs no files beside it. `SKILL.md`, the file an agent loads first, comes first.
 */
export const BUNDLED_SKILL: readonly SkillFile[] = [
	{ path: 'SKILL.md', text: skill },
	{ path: 'reference.md', text: reference }
];
