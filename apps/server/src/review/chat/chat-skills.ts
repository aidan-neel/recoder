import type { Review } from '@recoder/shared';
import { RepoFilesError } from '../../repo-files/errors';
import type { LoadedSkill } from '../../skills/discovery';
import { isEmptyRequest, loadRepoSkills, UnknownSkillError, type SkillRequest } from '../../skills/repo-skills';
import { db } from '../../store';
import { ReviewChatError } from './chat-input';

/** Reading skills for a message never runs past this. */
const SKILLS_TIMEOUT_MS = 10_000;

/**
 * The skills a message in a review's chat asks for, with their text, read at the review's head and, for a skill
 * the head lacks, at the repository's default branch. Refuses the message when the repository has no attached
 * skill of a name (400) or its copy cannot be read now (409). A message that only mentions names sends without
 * them when they cannot be read: an `@` may name a person.
 */
export async function attachedReviewSkills(
	review: Pick<Review, 'repoId' | 'headSha'>,
	request: SkillRequest
): Promise<LoadedSkill[]> {
	if (isEmptyRequest(request)) return [];

	const repo = await db.repos.get(review.repoId);
	const mentionsOnly = request.attached.length === 0;

	if (!repo && mentionsOnly) return [];
	if (!repo) throw new ReviewChatError('The repository is no longer tracked, so its skills cannot be read.', 409);

	try {
		return await loadRepoSkills(repo, request, review.headSha, AbortSignal.timeout(SKILLS_TIMEOUT_MS));
	} catch (error) {
		if (error instanceof UnknownSkillError) throw new ReviewChatError(error.message, 400);
		if (error instanceof RepoFilesError) throw new ReviewChatError(error.message, 409);

		throw error;
	}
}
