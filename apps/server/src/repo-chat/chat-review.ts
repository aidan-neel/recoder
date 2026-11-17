import type { Repo, RepoChatMessage } from '@recoder/shared';
import { queueReview } from '../commands/pipeline';
import { GhError } from '../forge/cli';
import { fetchPull } from '../forge/pull-preview';
import { looksLikeReviewRequest } from '../review/chat/review-request';
import { db } from '../store';

/** A pull request number as people write one: `#42`, `!42`, `PR 42`, `pull request 42` or a link to it. */
const PULL_NUMBER = [
	/(?:^|[\s(])[#!](\d{1,7})\b/,
	/\b(?:pr|pull request|pull|mr|merge request)\s*#?(\d{1,7})\b/i,
	/\/(?:pull|pulls|merge_requests)\/(\d{1,7})\b/
];

/**
 * The pull request a message asks Recoder to review ("review #42", "can you
 * review PR 42?"), or null. A message that names no pull request, or asks
 * something else about one, goes to the model instead.
 */
export function requestedReview(text: string): number | null {
	if (!looksLikeReviewRequest(text)) return null;

	for (const pattern of PULL_NUMBER) {
		const number = Number(pattern.exec(text)?.[1]);

		if (number > 0) return number;
	}

	return null;
}

/**
 * Starts a review of the pull request, with the message (if any) as its brief, the
 * same way the New review screen does. When one is already queued or
 * running, the reply points to it instead of starting another. A pull request
 * the forge cannot find, or a refusal (no reviewer model set up), becomes the
 * reply's failure, so no review is queued for a number that does not exist.
 */
export async function reviewFromChat(
	repo: Repo,
	prNumber: number,
	brief: string | undefined,
	startedBy?: string
): Promise<Pick<RepoChatMessage, 'text' | 'review' | 'failure'>> {
	const running = (await db.reviews.list()).find(
		(review) =>
			review.repoId === repo.id &&
			review.prNumber === prNumber &&
			(review.status === 'queued' || review.status === 'running')
	);

	if (running) return { text: `A review of #${prNumber} is already running.`, review: { id: running.id, prNumber } };

	const unreadable = await unreadablePull(repo, prNumber);

	if (unreadable) return { text: '', failure: { reason: unreadable } };

	try {
		const review = await queueReview({ repoId: repo.id, prNumber, instructions: brief }, startedBy);

		return { text: `Started a review of #${prNumber}.`, review: { id: review.id, prNumber } };
	} catch (error) {
		return { text: '', failure: { reason: error instanceof Error ? error.message : 'Could not start the review.' } };
	}
}

/** Why the forge cannot give the pull request, or null when it can. */
async function unreadablePull(repo: Repo, prNumber: number): Promise<string | null> {
	try {
		await fetchPull(repo, prNumber, { metadataOnly: true });

		return null;
	} catch (error) {
		if (error instanceof GhError && error.kind === 'not-found') return `${repo.name} has no pull request #${prNumber}.`;

		return `Could not read #${prNumber}: ${error instanceof Error ? error.message : 'the forge did not answer.'}`;
	}
}
