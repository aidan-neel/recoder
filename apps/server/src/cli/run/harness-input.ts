import type { AdaptiveReviewInput } from '../../review/pipeline/harness/types.js';
import type { ReportSettings } from '../report/report.js';
import type { ReviewOptions } from '../review/options.js';
import type { ResolvedTarget } from '../target/resolve-target.js';

/** Everything the harness's input is made from. */
interface HarnessRun {
	options: ReviewOptions;
	target: ResolvedTarget;
	settings: ReportSettings;
	signal: AbortSignal;
}

/**
 * The harness's input. The caller's title and description win over the forge's. A null lens list is left out, so
 * every lens that fits a slice runs, and the saved-settings fallbacks are already in `settings`.
 */
export function harnessInput({ options, target, settings, signal }: HarnessRun): AdaptiveReviewInput {
	const { intent, tuning } = options;

	return {
		diff: target.diff,
		sandboxPath: target.sandboxPath,
		revision: target.revision,
		repoId: null,
		prTitle: intent.title ?? target.title,
		prBody: intent.body ?? target.body,
		instructions: intent.instructions,
		tokenBudget: tuning.budget,
		subagentCap: settings.subagents,
		reportLowSeverity: settings.reportLowSeverity,
		baselineCache: tuning.baselineCache,
		...(tuning.lenses ? { lenses: tuning.lenses } : {}),
		signal
	};
}
