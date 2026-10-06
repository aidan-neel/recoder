import { reviewNow } from '../../session/review-control.js';
import { ReviewAbortedError } from '../agent-loop.js';
import { changeModelStage } from './change-model-stage.js';
import { consolidate } from './consolidation.js';
import {
	createRun,
	finishedIds,
	openWorkspace,
	poolContext,
	publishBudget,
	publishCandidates,
	publishCoverage,
	saveCheckpoint,
	type ReviewRun
} from './context.js';
import { deriveObligationsStage, runUnitsWithObligations } from '../obligations/stage.js';
import { intentStage } from './intent-stage.js';
import { runUnitPool } from './pool.js';
import { detectorStage, diagnosticStage, ruleLedgerStage } from './quality-stage.js';
import { checksInTime, prepareSandbox, startSetup, waitForBackground } from './sandbox-setup.js';
import { runSubagents } from './subagent-stage.js';
import { completeReview, stoppedReview } from './summary.js';
import type { AdaptiveReviewInput, AdaptiveReviewResult, HarnessEvents } from './types.js';
import { understandChanges } from './understand.js';
import { cutUnits, retryFailedUnits } from './unit-stage.js';
import { drainVerification, finishVerification, startVerification } from './verification.js';

/**
 * Custom review harness. Reviewers never change the pull request:
 * - inputs are the PR diff + git objects from the sandbox checkout;
 * - the model is instructed (and the output schema enforces) review-only
 *   findings — no patches, pushes or comments;
 * - when the OS sandbox is available, agents may run commands and write scratch
 *   files, but only inside an isolated, offline copy of the checkout
 *   (`exec-sandbox.ts`); tracked files are restored after every command.
 *
 * Stages: understand → cut units → change model, intent (and obligations,
 * with `RECODER_OBLIGATIONS=1`) and rule ledger, while the sandbox installs →
 * every unit through every lens (failed ones retried once), in one pool with
 * the obligation investigations, then the subagents reviewers asked for when the lenses found
 * anything → consolidate. Three things overlap the reviewers rather than
 * follow them: the baseline checks, the detectors, and the verifiers, which
 * take each candidate as it is reported. Checks still queued once everything
 * else is done are left behind after a short grace. Only proven findings are shown;
 * consolidation is deterministic, so the same change gives the same findings.
 * The deadline runs on the review clock, which stands still while paused.
 */
export async function runAdaptiveReview(
	input: AdaptiveReviewInput,
	events?: HarnessEvents
): Promise<AdaptiveReviewResult> {
	const run = createRun(input, events);
	const onAbort = () => run.controller.abort();

	input.signal?.addEventListener('abort', onAbort, { once: true });

	const timeout = setInterval(() => {
		if (reviewNow() >= run.deadlineAt) run.controller.abort();
	}, 1_000);

	await openWorkspace(run);

	try {
		return await runStages(run);
	} catch (err) {
		return stoppedReview(run, err);
	} finally {
		clearInterval(timeout);
		input.signal?.removeEventListener('abort', onAbort);
		await closeWorkspace(run);
	}
}

/** Every stage in order; throws when the review is blocked, cancelled or out of time. */
async function runStages(run: ReviewRun): Promise<AdaptiveReviewResult> {
	await understandChanges(run);

	const setup = startSetup(run);

	cutUnits(run);
	publishCoverage(run);
	publishBudget(run);
	saveCheckpoint(run);

	const context = Promise.all([
		changeModelStage(run).then((): Promise<unknown> =>
			run.obligations ? Promise.all([intentStage(run), deriveObligationsStage(run)]) : intentStage(run)
		),
		ruleLedgerStage(run)
	]);

	const checks = await prepareSandbox(run, setup);

	await context;

	run.events?.onStage?.('reviewing');
	if (run.controller.signal.aborted) throw new ReviewAbortedError('review aborted');

	startVerification(run);

	const detectors = detectorStage(run);
	let closed = false;
	const diagnostics = checks().then(() => (closed ? undefined : diagnosticStage(run, () => closed, detectors)));

	const finishedAtStart = finishedIds(run);
	const units = run.units.filter((unit) => !finishedAtStart.has(unit.id));

	if (run.obligations) await runUnitsWithObligations(run, units);
	else await runUnitPool(units, run.assignments, poolContext(run));

	publishCoverage(run);
	publishBudget(run);
	publishCandidates(run);

	await retryFailedUnits(run);
	await runSubagents(run);

	publishCoverage(run);
	publishBudget(run);
	publishCandidates(run);

	await waitForBackground(run, detectors);
	await drainVerification(run);

	closed = !(await checksInTime(run, diagnostics));

	await finishVerification(run);

	const consolidated = consolidate(run);

	publishCoverage(run);
	publishBudget(run);

	return completeReview(run, consolidated);
}

/** Stops an install still running after an early exit, then removes the sandbox. */
async function closeWorkspace(run: ReviewRun): Promise<void> {
	if (!run.workspace) return;

	run.controller.abort();
	await run.workspace.cleanup().catch(() => undefined);
}
