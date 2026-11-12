import type { Review } from '@recoder/shared';
import type { IntentSource } from '../../review/pipeline/intent/types.js';
import { db } from '../../store.js';
import { findingLine } from './past-reviews.js';
import { CONTEXT_CAPS, makeSource } from './sources.js';

/** What picks the earlier reviews whose findings this review is told about. */
export interface RelatedReviewInput {
	repoId: string;
	/** The history the intent stage gathered; its `pr:#N` sources name the PRs that last changed this code. */
	history: IntentSource[];
	/** The changed files; only findings on them are passed on. */
	files: string[];
	/** The merge base's commit time. Reviews created after it are left out, so a rerun sees the same sources. */
	cutoff: string;
}

/** A history ref that names a pull request: `pr:#31`. */
const PR_REF = /^pr:#(\d+)$/;

/**
 * What Recoder found on these files when it reviewed the earlier pull
 * requests that last changed the same code. Only PRs the history reached
 * through the base's ancestry count, only their latest finished review from
 * before the cutoff, and only findings on files this PR changes. The newest
 * reviews are kept when there are more than the cap.
 */
export function relatedReviewSources(input: RelatedReviewInput): IntentSource[] {
	const prs = historyPrs(input.history);
	const cutoff = Date.parse(input.cutoff);

	if (!prs.size || Number.isNaN(cutoff)) return [];

	const files = new Set(input.files);
	const latest = new Map<number, Review>();

	const earlier = db.reviews
		.list()
		.filter(
			(review) =>
				review.repoId === input.repoId &&
				prs.has(review.prNumber) &&
				review.status === 'passed' &&
				Date.parse(review.createdAt) <= cutoff
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

	for (const review of earlier) latest.set(review.prNumber, review);

	return [...latest.values()]
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
		.map((review) => ({ review, lines: findingLines(review, files) }))
		.filter(({ lines }) => lines.length)
		.slice(-CONTEXT_CAPS.relatedReviews)
		.map(({ review, lines }) =>
			makeSource({
				kind: 'related-review',
				ref: `review:#${review.prNumber}`,
				title: `Recoder review of PR #${review.prNumber}`,
				at: review.createdAt,
				text: lines.join('\n')
			})
		);
}

function historyPrs(history: IntentSource[]): Set<number> {
	const numbers = history.flatMap((source) => {
		const match = source.kind === 'pr-history' ? PR_REF.exec(source.ref) : null;

		return match ? [Number(match[1])] : [];
	});

	return new Set(numbers);
}

/** The review's shown findings on the changed files; findings people quieted stay out, as in a past review. */
function findingLines(review: Review, files: Set<string>): string[] {
	return review.findings.filter((finding) => files.has(finding.file) && !finding.topic?.quieted).map(findingLine);
}
