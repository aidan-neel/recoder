import { reviewSkillsContext } from '../../../skills/review-skills.js';
import type { ReviewRun } from './context.js';

/**
 * Builds what every agent of the review reads about repository skills, once, from the pull request's checkout. A
 * review with no checkout has no skills. A checkout whose skills cannot be read is reported and reviewed without
 * them, since skills only add guidance.
 */
export async function skillsStage(run: ReviewRun): Promise<void> {
	const { revision, skills } = run.input;

	if (!revision) return;

	try {
		run.skills = await reviewSkillsContext(
			revision,
			skills ?? [],
			(message) => run.events?.onLog?.(message),
			run.controller.signal
		);
	} catch (error) {
		run.events?.onLog?.(
			`Reviewing without repository skills: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
