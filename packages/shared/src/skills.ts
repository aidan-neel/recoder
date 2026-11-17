/** A skill a repository ships: a `SKILL.md` under `.claude/skills/<name>/`, `.agents/skills/<name>/` or `skills/<name>/`. */
export interface SkillSummary {
	name: string;
	description: string;
	/** Repository path of the skill's `SKILL.md`. */
	path: string;
}

/** The most skills one message (or a review's brief) may attach. */
export const MAX_MESSAGE_SKILLS = 4;

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Whether `name` can name a skill: letters, digits, dots, dashes and underscores, at most 64 characters. */
export function isSkillName(name: string): boolean {
	return SKILL_NAME.test(name);
}

/** A `/` at the start or after white space, then a word: a skill named in a message's text. */
const MENTION = /(?:^|\s)\/(\S+)/g;

/** Punctuation that ends a sentence after a mention, and is not part of the name: `use /giga-ui.` */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/**
 * The skill names a message's text mentions with `/name`, in order and without repeats. A `/` inside a word is not a
 * mention, and a word that cannot name a skill (a path such as `/src/app.ts`) is skipped.
 */
export function skillMentions(text: string): string[] {
	const names = [...text.matchAll(MENTION)].map((match) => (match[1] ?? '').replace(TRAILING_PUNCTUATION, ''));

	return [...new Set(names.filter(isSkillName))];
}
