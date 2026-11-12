import { withLockedModels } from '../../models/models.js';
import { runAdaptiveReview } from '../../review/pipeline/harness/run.js';
import type { AdaptiveReviewResult } from '../../review/pipeline/harness/types.js';
import type { ProgressSink } from '../progress.js';
import type { ReviewOptions } from '../review/options.js';
import type { ReviewReport } from '../report/report.js';
import type { ResolvedTarget } from '../target/resolve-target.js';
import { buildReport } from './build-report.js';
import { harnessEvents } from './harness-events.js';
import { harnessInput } from './harness-input.js';
import { describeSettings } from './report-settings.js';
import type { RunSignal } from './run-signal.js';

/** A resolved target, the options to review it with, and where the run reports to. */
interface ResolvedRun {
	options: ReviewOptions;
	target: ResolvedTarget;
	progress: ProgressSink;
	stop: RunSignal;
	startedAtMs: number;
}

const NOT_STARTED: AdaptiveReviewResult = {
	findings: [],
	unconfirmed: [],
	summary: 'The review was stopped before it started.',
	outcome: 'failed',
	recommendedChecks: [],
	coverage: { reviewed: 0, pending: 0, partial: 0, excluded: 0, total: 0 },
	coverageGaps: [],
	assignments: []
};

/** Runs the review harness on a resolved target, on the models the run locked, and turns what it returns into the report. */
export async function reviewResolvedTarget(run: ResolvedRun): Promise<ReviewReport> {
	const { options, target, stop } = run;
	const settings = await describeSettings(options.tuning, options.scope, target.revision);
	const input = harnessInput({ options, target, settings, signal: stop.signal });

	const result = stop.signal.aborted
		? NOT_STARTED
		: await withLockedModels(() => runAdaptiveReview(input, harnessEvents(run.progress)));

	return buildReport({
		result,
		target: target.report,
		settings,
		stopReason: stop.stopReason(),
		startedAtMs: run.startedAtMs,
		endedAtMs: Date.now()
	});
}
