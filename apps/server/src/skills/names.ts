import { z } from 'zod';
import { isSkillName, MAX_MESSAGE_SKILLS } from '@recoder/shared';

const NOT_A_NAME = 'A skill name uses letters, digits, dots, dashes and underscores, and at most 64 characters.';
const TOO_MANY = `Attach at most ${MAX_MESSAGE_SKILLS} skills.`;

function withoutRepeats(names: string[]): string[] {
	return [...new Set(names)];
}

/** The skills a request attaches: valid names without repeats, at most `MAX_MESSAGE_SKILLS`, none when left out. */
export const skillsSchema = z
	.array(z.string())
	.transform(withoutRepeats)
	.pipe(z.array(z.string().refine(isSkillName, NOT_A_NAME)).max(MAX_MESSAGE_SKILLS, TOO_MANY))
	.optional();

/** What is wrong with the request's skills, for the 400 that refuses it; null when the problem is elsewhere. */
export function skillProblem(error: z.ZodError): string | null {
	return error.issues.find((issue) => issue.path[0] === 'skills')?.message ?? null;
}
