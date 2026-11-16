import { findingTone, type ReviewListItem } from '@recoder/shared';

import { isOpenFinding } from '../api/reviews';
import type { RowEntry } from './use-rows';

/** The open findings of a review that are bugs, not suggestions. */
function openBugs(review: ReviewListItem | null): ReviewListItem['findings'] {
	return (review?.findings ?? []).filter((finding) => isOpenFinding(finding) && finding.kind !== 'quality');
}

/**
 * How many of a pull request's open bugs are high: not decided, not quieted, not a suggestion. Only a row that shows
 * its bugs counts them, so a review of an older head or one still running counts none.
 */
export function highBugs({ listed, row }: RowEntry): number {
	if (row.status.kind !== 'bugs') return 0;

	return openBugs(listed.review).filter((finding) => findingTone(finding.severity) === 'high').length;
}
