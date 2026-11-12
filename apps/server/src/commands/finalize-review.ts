import type { Finding } from '@recoder/shared';
import type { AdaptiveReviewResult } from '../review/pipeline/harness/types';
import { db, reviewProgress, keepForReplay, settlePipelineStreams } from '../store';
import { storageTransaction } from '../storage/backend';
import { metricWrites } from '../storage/persistence-queue';
import { emitReviewEvent, flushReviewEvents, reportReviewTask, settleReviewTasks } from '../review/session/events';
import { touch } from './review-session';

export async function finalizeReview(reviewId: string, result: AdaptiveReviewResult): Promise<void> {
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
