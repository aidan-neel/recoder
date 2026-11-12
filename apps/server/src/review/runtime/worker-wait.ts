import type { ReviewWorkerWait } from '@recoder/shared';
import { db, reviewProgress } from '../../store';
import { commitGatedReviewEvent, emitReviewEvent, flushReviewEvents, type ReviewEvent } from '../session/events';
import type { PostgresCoordinator, WorkerBacklog } from './coordinator';

/** A review younger than this in the queue is left alone, since a free worker takes it within a poll or two. */
const WORKER_WAIT_GRACE_MS = 2000;

/**
 * Keeps the progress of each queued review that no worker has taken saying so, with its place in line, and clears
 * that once a worker takes it, so backpressure reads as a queue instead of a stuck review. The returned function
 * reports one round; it remembers what it last wrote so an unchanged wait is not written again.
 */
export function createWorkerWaitReporter(
	coordinator: Pick<PostgresCoordinator, 'backlog' | 'whileClaimable'>
): () => Promise<void> {
	const reported = new Map<string, string>();

	return async () => {
		const waits = workerWaits(await coordinator.backlog(WORKER_WAIT_GRACE_MS));

		for (const [reviewId, wait] of waits) {
			const written = JSON.stringify(wait);

			if (reported.get(reviewId) === written) continue;
			if (!(await writeWorkerWaitWhileUnclaimed(coordinator, reviewId, wait))) continue;

			reported.set(reviewId, written);
		}

		for (const reviewId of [...reported.keys()]) {
			if (waits.has(reviewId)) continue;

			reported.delete(reviewId);
			await clearWorkerWait(reviewId);
		}
	};
}

/** Clears the review's worker wait, if its progress has one, once a worker takes the review. */
export async function clearWorkerWait(reviewId: string): Promise<void> {
	if (!(await reviewProgress.get(reviewId))?.workerWait) return;

	emitReviewEvent(reviewId, workerWaitEvent(null));
	await flushReviewEvents(reviewId);
}

/** The wait of each review that has waited past the grace, keyed by review id; its place counts everything ahead. */
function workerWaits(backlog: WorkerBacklog): Map<string, ReviewWorkerWait> {
	const waits = new Map<string, ReviewWorkerWait>();

	backlog.waiting.forEach((entry, index) => {
		if (!entry.overdue) return;

		waits.set(entry.reviewId, {
			since: entry.requestedAt.toISOString(),
			position: index + 1,
			running: backlog.running
		});
	});

	return waits;
}

/** A started review that has not run yet; a finished review waiting to answer a chat message is not one. */
async function isQueued(reviewId: string): Promise<boolean> {
	return (await db.reviews.get(reviewId))?.status === 'queued';
}

/**
 * Writes the wait in the same transaction that checks no worker holds the review, so a worker that claims it meanwhile
 * either waits for the write and then clears it, or makes the write skip. Says whether it was written.
 */
async function writeWorkerWaitWhileUnclaimed(
	coordinator: Pick<PostgresCoordinator, 'whileClaimable'>,
	reviewId: string,
	wait: ReviewWorkerWait
): Promise<boolean> {
	return commitGatedReviewEvent(reviewId, workerWaitEvent(wait), (store) =>
		coordinator.whileClaimable(reviewId, async () => ((await isQueued(reviewId)) ? store() : undefined))
	);
}

function workerWaitEvent(workerWait: ReviewWorkerWait | null): Omit<ReviewEvent, 'at'> {
	return { type: 'step', step: 'queued', message: '', data: { workerWait } };
}
