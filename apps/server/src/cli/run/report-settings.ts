import { effectiveReportLowSeverity } from '../../review/session/review-settings.js';
import { configForOrchestrator, configForSubagent, configForVerifier } from '../../models/models.js';
import { execUnavailableReason } from '../../sandbox/exec-sandbox.js';
import type { ReviewRevision } from '../../evidence/evidence.js';
import type { ReportSettings } from '../report/report.js';
import type { ReviewTuning } from '../review/options.js';
import { subagentCapOf } from './run-settings.js';

const EXEC_TURNED_OFF = 'Code execution was turned off for this review.';

const NO_CHECKOUT = 'There is no checkout to run code in: a bare diff has no repository.';

/**
 * What the review runs with, after flags, the budget and the saved settings are combined. The models and efforts are
 * read back from the settings the run applied, so they are what the reviewers really get.
 */
export async function describeSettings(tuning: ReviewTuning, revision: ReviewRevision | null): Promise<ReportSettings> {
	const review = configForOrchestrator();
	const worker = configForSubagent();
	const verifier = configForVerifier();
	const execReason = await execReasonOf(tuning, revision);

	return {
		budget: tuning.budget,
		subagents: subagentCapOf(tuning),
		reviewerModel: review.model,
		workerModel: worker.model,
		verifierModel: verifier.model === review.model ? null : verifier.model,
		reviewerEffort: review.reasoningEffort ?? null,
		workerEffort: worker.reasoningEffort ?? null,
		lenses: tuning.lenses,
		reportLowSeverity: tuning.reportLowSeverity ?? effectiveReportLowSeverity(),
		exec: execReason === null,
		execReason
	};
}

/** Why no code runs: the caller turned it off, there is no checkout, or the machine has no sandbox; null when code runs. */
async function execReasonOf(tuning: ReviewTuning, revision: ReviewRevision | null): Promise<string | null> {
	if (!tuning.exec) return EXEC_TURNED_OFF;
	if (!revision) return NO_CHECKOUT;

	return execUnavailableReason();
}
