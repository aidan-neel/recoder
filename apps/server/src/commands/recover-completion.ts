import type { Review } from '@recoder/shared';
import { keepForReplay, reviewProgress, settlePipelineStreams } from '../store';
import { storageTransaction } from '../storage/backend';
import { emitReviewEvent, flushReviewEvents, reportReviewTask, settleReviewTasks } from '../review/session/events';

export async function recoverCompletion(review: Review): Promise<void> {
	if (review.status !== 'passed' && review.status !== 'failed') return;

	const progress = await reviewProgress.get(review.id);
	const complete = review.status === 'passed';
	const status = complete ? 'done' : 'error';

	if (progress?.tasks.finalize?.status === status) return;

	await flushReviewEvents(review.id);

	await storageTransaction(async () => {
		if (complete) await keepForReplay(review.id);

		reportReviewTask(review.id, {
			id: 'finalize',
			label: 'Saving results',
			kind: 'other',
			status,
			message: complete ? 'Review complete' : 'Review failed'
		});

		await settleReviewTasks(review.id, complete ? null : (review.summary ?? 'Review failed'));

		const settled = await settlePipelineStreams(review.id);

		emitReviewEvent(review.id, {
			type: complete ? 'done' : 'error',
			message: review.summary ?? (complete ? 'Review complete' : 'Review failed'),
			data: {
				outcome: complete ? 'complete' : 'failed',
				...(settled ? { settled: { messages: settled.messages, reasoning: settled.reasoning } } : {})
			}
		});

		await flushReviewEvents(review.id);
	});
}
