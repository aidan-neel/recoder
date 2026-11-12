import type { Finding, Review } from '@recoder/shared';
import { db, reviewDiffs } from '../../store';
import { approvedTopics } from '../guidelines/learned/proposals.js';
import { carryHistory } from './carry.js';
import { diffFiles } from './code-change.js';

/**
 * The passed reviews of the same pull request created before `review`,
 * newest first: the history its findings are set against.
 */
async function earlierReviews(review: Review): Promise<Review[]> {
	const reviews = await db.reviews.list();

	return reviews
		.filter(
			(candidate) =>
				candidate.id !== review.id &&
				candidate.repoId === review.repoId &&
				candidate.prNumber === review.prNumber &&
				candidate.status === 'passed' &&
				candidate.createdAt < review.createdAt
		)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A finding as an earlier review of the pull request stored it, with that review's diff. */
export interface EarlierCopy {
	finding: Finding;
	diff: string;
}

/**
 * The finding `findingId` as the earlier reviews of the pull request stored
 * it, newest first. History keeps a finding's id across pushes, so these are
 * the same defect, perhaps under another fingerprint or category. A review
 * whose diff is gone gives an empty one.
 */
export async function earlierCopies(review: Review, findingId: string): Promise<EarlierCopy[]> {
	const copies = (await earlierReviews(review)).flatMap((earlier) =>
		earlier.findings.filter((finding) => finding.id === findingId).map((finding) => ({ reviewId: earlier.id, finding }))
	);

	return Promise.all(
		copies.map(async ({ reviewId, finding }) => ({ finding, diff: (await reviewDiffs.get(reviewId)) ?? '' }))
	);
}

/**
 * A finished review's findings with their history across pushes
 * (`carryHistory`), and the earlier findings its evidence shows fixed. The
 * first review of a pull request keeps its findings as they are, with no
 * history. An earlier review whose diff is gone reads as touching every file,
 * so nothing of it is carried as untouched.
 */
export async function withFindingHistory(
	reviewId: string,
	findings: Finding[],
	unconfirmed: Finding[]
): Promise<Pick<Review, 'findings' | 'resolved'>> {
	const review = await db.reviews.get(reviewId);

	if (!review) throw new Error(`review ${reviewId} not found while attaching finding history`);

	const [previous] = await earlierReviews(review);

	if (!previous) return { findings };

	const [before, after] = await Promise.all([reviewDiffs.get(previous.id), reviewDiffs.get(reviewId)]);

	return carryHistory(
		{ headSha: previous.headSha, findings: previous.findings, diff: diffFiles(before ?? '') },
		{
			headSha: review.headSha,
			findings,
			unconfirmed,
			diff: diffFiles(after ?? ''),
			quietedTopics: approvedTopics(review.repoId)
		}
	);
}
