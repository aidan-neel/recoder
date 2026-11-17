import type { ReviewRevision } from '../evidence/types';
import { findSkills, listSkills, type SkillRevision } from './discovery';
import { reviewSkillsBlock } from './prompt';

/** A review's checkout at the revisions its skills are read from. */
type CheckoutRevisions = Pick<ReviewRevision, 'checkoutPath' | 'headSha' | 'targetSha'>;

/** The pull request head, then the target it merges into: a skill the head changed or added wins. */
function checkoutSkillRevisions({ checkoutPath, headSha, targetSha }: CheckoutRevisions): SkillRevision[] {
	return [...new Set([headSha, targetSha])].filter(Boolean).map((sha) => ({ root: checkoutPath, sha }));
}

/**
 * What every agent of a review reads about skills, as one block built once so each agent's prompt carries the same
 * bytes: the skills attached to the review's brief in full, then the catalog of the repository's skills. A skill
 * named in the brief that the checkout lacks is reported through `onMissing` and left out. Empty when the
 * repository has no skills and none were attached.
 */
export async function reviewSkillsContext(
	revision: CheckoutRevisions,
	attached: readonly string[],
	onMissing: (message: string) => void,
	signal?: AbortSignal
): Promise<string> {
	const revisions = checkoutSkillRevisions(revision);
	const catalog = await listSkills(revisions, signal);
	const found = await findSkills(revisions, attached, signal);

	if (found.missing.length > 0) {
		onMissing(`Skipped the attached skills this pull request does not have: ${found.missing.join(', ')}.`);
	}

	return reviewSkillsBlock(found.skills, catalog);
}
