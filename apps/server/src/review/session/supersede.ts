import { db } from '../../store';
import { getReviewControl } from './review-control';
import { coordinator, storageTransaction } from '../../storage/backend';
import { enqueueCommand } from '../runtime/inbox';

/**
 * A newer push or mention makes an automatic review (webhook or watcher) of
 * the same PR stale, so it is cancelled instead of running beside the new
 * one. Reviews a developer started are left alone.
 */
export async function supersedeAutomaticReviews(repoId: string, prNumber: number): Promise<void> {
	for (const review of await db.reviews.list()) {
		const samePr = review.repoId === repoId && review.prNumber === prNumber;
		const inFlight = review.status === 'queued' || review.status === 'running';

		if (review.trigger && samePr && inFlight) {
			const reason = 'Superseded by a newer automatic review.';

			if (coordinator) {
				await storageTransaction(async (transaction) => {
					if (!transaction) throw new Error('Shared review coordination is not configured.');
					await enqueueCommand(transaction, review.id, { id: crypto.randomUUID(), kind: 'cancel', reason });
				});
			} else getReviewControl(review.id)?.cancel(reason);
		}
	}
}
