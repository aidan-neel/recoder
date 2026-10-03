import { reviewNow } from '../../session/review-control.js';
import { ReviewAbortedError } from '../agent-loop.js';
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
import { runSecondWave } from './follow-ups.js';
import { planReview } from './planning.js';
import { runAssignmentPool } from './pool.js';
import { plannerExecNotes, prepareSandbox, startSetup } from './sandbox-setup.js';
import { completeReview, stoppedReview } from './summary.js';
import type { AdaptiveReviewInput, AdaptiveReviewResult, HarnessEvents } from './types.js';
import { understandChanges } from './understand.js';
import { verifyStage } from './verification.js';

/**
 * Custom review harness. Reviewers never change the pull request:
 * - inputs are the PR diff + git objects from the sandbox checkout;
 * - the model is instructed (and the output schema enforces) review-only
 *   findings — no patches, pushes or comments;
 * - when the OS sandbox is available, agents may run commands and write scratch
 *   files, but only inside an isolated, offline copy of the checkout
 *   (`exec-sandbox.ts`); tracked files are restored after every command.
 *
 * Stages: understand → plan → baseline checks → specialists → verify →
 * consolidate. Verification re-proves every candidate by running code.
 * The deadline runs on the review clock, which stands still while paused or waiting for approval.
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
	const execNotes = run.workspace ? await plannerExecNotes(run.workspace) : undefined;
	const plan = await planReview(run, execNotes);

	publishCoverage(run);
	publishBudget(run);
	saveCheckpoint(run);

	await prepareSandbox(run, plan, setup);

	run.events?.onStage?.('specialists');
	if (run.controller.signal.aborted) throw new ReviewAbortedError('review aborted');

	const finishedAtStart = finishedIds(run);

	await runAssignmentPool(
		run.items.filter((item) => !finishedAtStart.has(item.id)),
		run.assignments,
		poolContext(run, run.followUps)
	);

	publishCoverage(run);
	publishBudget(run);
	publishCandidates(run);

	await runSecondWave(run, plan);
	await verifyStage(run);

	const consolidated = await consolidate(run);

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
