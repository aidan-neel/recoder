import type { ProgressSink } from '../progress.js';
import type { ReviewReport } from '../report/report.js';
import type { ReviewOptions } from '../review/options.js';
import { resolveTarget } from '../target/resolve-target.js';
import { runReviewFlow } from './run-flow.js';

/**
 * Reviews the target `options` names in this process, with no server. Throws a `CliError` when the machine is not
 * ready or an option is wrong; a review that starts and stops early still returns a report that says why.
 */
export async function runReview(
	options: ReviewOptions,
	progress: ProgressSink,
	signal: AbortSignal
): Promise<ReviewReport> {
	return runReviewFlow(resolveTarget, options, progress, signal);
}
