import type { Review } from '@recoder/shared';
import type { IntentSource } from '../../review/pipeline/intent/types.js';
import { db } from '../../store.js';
import { CONTEXT_CAPS, makeSource } from './sources.js';

/** One finding as a single line: severity, place and title. */
function findingLine(finding: Review['findings'][number]): string {
	const place = finding.line ? `${finding.file}:${finding.line}` : finding.file;
	const title = finding.title ?? finding.message.split('\n')[0];

	return `- [${finding.severity}] ${place} ${title}`;
}

/**
 * What Recoder said about earlier pushes of this PR. Only finished reviews of
 * a different head commit count: a rerun of the same head must see the same
 * sources as the first run, or its intent would differ.
 */
export function pastReviewSources(repoId: string, prNumber: number, headSha: string): IntentSource[] {
	const latestPerHead = new Map<string, Review>();

	const finished = db.reviews
		.list()
		.filter(
			(review) =>
				review.repoId === repoId &&
				review.prNumber === prNumber &&
				review.status === 'passed' &&
				review.headSha &&
				review.headSha !== headSha
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

	for (const review of finished) latestPerHead.set(review.headSha, review);

	return [...latestPerHead.values()].slice(-CONTEXT_CAPS.pastReviews).map((review) =>
		makeSource({
			kind: 'past-review',
			ref: `review:${review.headSha.slice(0, 7)}`,
			title: `Recoder review of ${review.headSha.slice(0, 7)}`,
			at: review.createdAt,
			text: [review.summary ?? '', ...review.findings.map(findingLine)].filter(Boolean).join('\n')
		})
	);
}
