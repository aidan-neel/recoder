import type { ReportTarget } from '../report/report.js';
import { shortSha } from '../short-sha.js';

/**
 * The commit a review started after, as the target line names it: `since
 * 1a2b3c4` for `--since`, `since 1a2b3c4 (run <id>)` when it continued an
 * earlier review, and null when the review covered the whole change. A report
 * from before the field existed has none, and is named as a whole review.
 */
export function sinceLabel(target: ReportTarget): string | null {
	if (!target.since) return null;

	const run = target.sinceRunId ? ` (run ${target.sinceRunId})` : '';

	return `since ${shortSha(target.since)}${run}`;
}

/**
 * The line a continued review logs once its target is resolved, so a long
 * review does not look like it started over; null when the review is not one.
 */
export function continuedReviewMessage(target: ReportTarget): string | null {
	if (!target.since || !target.sinceRunId) return null;

	return `Reviewing the commits after ${shortSha(target.since)}, the head of run ${target.sinceRunId}. --full reviews the whole change.`;
}
