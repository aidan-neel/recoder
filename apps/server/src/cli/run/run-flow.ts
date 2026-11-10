import { isReviewConfigured } from '../../models/models.js';
import { CliError, EXIT, notReadyError } from '../exit.js';
import type { ProgressSink } from '../progress.js';
import type { ReviewReport } from '../report/report.js';
import type { ReviewOptions } from '../review/options.js';
import type { ResolvedTarget, TargetRequest } from '../target/resolve-target.js';
import { bootHeadless } from './boot.js';
import { assertChatGptSignedIn } from './chatgpt-signin.js';
import { MODEL_LOOKUP_LIMIT_MS } from './model-choices.js';
import { reviewResolvedTarget } from './run-harness.js';
import { openRunSignal, type RunSignal } from './run-signal.js';
import { withRunScope } from './run-scope.js';

/** Turns a request for a target into the checkout and diff to review. */
export type TargetResolver = (request: TargetRequest) => Promise<ResolvedTarget>;

const REVIEW_NOT_CONFIGURED =
	'No review model is configured. Set one up in Recoder\u2019s settings, or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL. Run `recoder doctor` to see what is missing.';

/**
 * One review from start to report: load the saved settings, apply this run's, resolve the target, run the harness and
 * build the report. The run's stop signal opens first, so a signal and `--timeout` also cover the model lookup. The checkout is removed afterwards unless the caller keeps it, and every setting the run changed is
 * put back, also when it throws.
 */
export async function runReviewFlow(
	resolve: TargetResolver,
	options: ReviewOptions,
	progress: ProgressSink,
	signal: AbortSignal
): Promise<ReviewReport> {
	const startedAtMs = Date.now();

	bootHeadless();

	const stop = openRunSignal(signal, options.timeoutMs);

	return withRunScope(options.tuning, { stop, limitMs: MODEL_LOOKUP_LIMIT_MS }, async () => {
		assertReviewConfigured();
		await assertChatGptSignedIn();
		progress({ type: 'stage', stage: 'checkout' });

		const target = await resolveWithin(resolve, options, stop);

		try {
			return await reviewResolvedTarget({ options, target, progress, stop, startedAtMs });
		} finally {
			if (!options.keepCheckout) await target.dispose();
		}
	});
}

/**
 * Resolves the target under the run's own signal, so `--timeout` also stops a slow clone. A resolver stopped by that
 * signal throws a bare cancellation; it is rethrown saying whether the caller cancelled or the timeout ran out.
 */
async function resolveWithin(
	resolve: TargetResolver,
	options: ReviewOptions,
	stop: RunSignal
): Promise<ResolvedTarget> {
	try {
		return await resolve({
			repoPath: options.repoPath,
			target: options.target,
			scope: options.scope,
			signal: stop.signal
		});
	} catch (error) {
		throw explainCancellation(error, stop);
	}
}

function explainCancellation(error: unknown, stop: RunSignal): unknown {
	const reason = stop.stopReason();

	if (reason && error instanceof CliError && error.exitCode === EXIT.cancelled) {
		return new CliError(`${reason} It was still preparing what to review.`, EXIT.cancelled);
	}

	return error;
}

function assertReviewConfigured(): void {
	if (!isReviewConfigured()) throw notReadyError(REVIEW_NOT_CONFIGURED);
}
