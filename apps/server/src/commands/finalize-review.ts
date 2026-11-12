import type { Finding, ReviewAssignment } from '@recoder/shared';
import type { AdaptiveReviewResult } from '../review/pipeline/harness/types';
import { db, reviewProgress, keepForReplay, settlePipelineStreams } from '../store';
import { storageTransaction } from '../storage/backend';
import { metricWrites } from '../storage/persistence-queue';
import { emitReviewEvent, flushReviewEvents, reportReviewTask, settleReviewTasks } from '../review/session/events';
import { touch } from './review-session';

/** Roles that are not a reviewer of the change: subagents and obligation investigators work on what reviewers raised. */
const NOT_REVIEWERS = new Set(['subagent', 'obligation']);

/**
 * Saves a finished run. A run that completed although none of its reviewers
 * could run is saved as failed, with the first reviewer's reason.
 */
export async function finalizeReview(reviewId: string, finished: AdaptiveReviewResult): Promise<void> {
	const result = withReviewerFailure(finished);

	await flushReviewEvents(reviewId);

	await metricWrites.drain(reviewId);

	await storageTransaction(async () => {
		await reviewProgress.update(reviewId, (snapshot) =>
			snapshot
				? {
						...snapshot,
						assignments: result.assignments,
						coverage: result.coverage,
						coverageGaps: result.coverageGaps,
						outcome: result.outcome,
						failure: result.failure,
						recommendedChecks: result.recommendedChecks,
						candidateCount: result.funnel?.raised ?? result.findings.length
					}
				: undefined
		);

		reportReviewTask(reviewId, {
			id: 'finalize',
			label: 'Saving results',
			message: 'Saving review results',
			status: 'running',
			kind: 'other'
		});

		const findings: Finding[] =
			result.outcome === 'complete' ? result.findings : [...result.findings, ...result.unconfirmed];

		const status = result.outcome === 'complete' ? 'passed' : 'failed';

		await touch(reviewId, {
			status,
			summary: result.summary,
			findings,
			unconfirmed: result.outcome === 'complete' ? result.unconfirmed : [],
			funnel: result.funnel,
			context: result.context,
			...(result.obligations ? { obligations: result.obligations } : {}),
			...(result.questions ? { questions: result.questions } : {})
		});

		if (status === 'passed') await keepForReplay(reviewId);

		reportReviewTask(reviewId, {
			id: 'finalize',
			label: 'Saving results',
			message: result.outcome === 'complete' ? 'Review complete' : 'Review failed',
			status: result.outcome === 'complete' ? 'done' : 'error',
			kind: 'other'
		});

		await settleReviewTasks(reviewId, result.outcome === 'complete' ? null : result.summary);

		emitReviewEvent(reviewId, {
			type: result.outcome === 'complete' ? 'done' : 'error',
			message: result.summary,
			data: {
				outcome: result.outcome,
				...(result.failure ? { failure: result.failure } : {}),
				coverage: result.coverage,
				coverageGaps: result.coverageGaps,
				recommendedChecks: result.recommendedChecks,
				candidateCount: result.findings.length
			}
		});

		await settleRun(reviewId);
		await flushReviewEvents(reviewId);
	});
}

/**
 * A completed run whose every reviewer stopped with an error or was never
 * launched, and raised nothing, reviewed none of the change: a provider that
 * rejects every call leaves only what detectors found. It fails with the
 * reason the first reviewer stopped, instead of passing with those findings.
 */
function withReviewerFailure(result: AdaptiveReviewResult): AdaptiveReviewResult {
	if (result.outcome !== 'complete') return result;

	const reviewers = result.assignments.filter((record) => !NOT_REVIEWERS.has(record.role));

	if (!reviewers.length || !reviewers.every(didNotReview)) return result;

	const stopped = reviewers.find((record) => record.status === 'error') ?? reviewers[0];
	const summary = `No reviewer could run: ${stopped.currentOperation ?? 'every reviewer failed'}`;

	return { ...result, outcome: 'failed', summary, error: summary };
}

/** A reviewer that stopped with an error or never started, and reported no candidate. */
function didNotReview(record: ReviewAssignment): boolean {
	return (record.status === 'error' || record.status === 'skipped') && !record.candidateCount;
}

/**
 * Close out a run, however it ended: settle the streamed messages and
 * reasoning (skipped when the review was deleted mid-run), then write the
 * final state to SQLite now rather than on the write-behind timer.
 */
export async function settleRun(reviewId: string): Promise<void> {
	if (!(await db.reviews.get(reviewId))) return;

	const settled = await settlePipelineStreams(reviewId);

	if (settled)
		emitReviewEvent(reviewId, {
			type: 'log',
			step: 'review',
			message: '',
			data: { settled: { messages: settled.messages, reasoning: settled.reasoning } }
		});

	await flushReviewEvents(reviewId);
	await reviewProgress.flush();
}
