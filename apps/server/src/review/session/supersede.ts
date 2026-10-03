import { db } from '../../store';
import { getReviewControl } from './review-control';

/**
 * A new push makes a webhook review of the old head stale, so it is cancelled
 * instead of running beside the new one. Reviews a developer started are left alone.
 */
export function supersedeWebhookReviews(repoId: string, prNumber: number): void {
	for (const review of db.reviews.list()) {
		const samePr = review.repoId === repoId && review.prNumber === prNumber;
		const inFlight = review.status === 'queued' || review.status === 'running';

		if (review.trigger === 'webhook' && samePr && inFlight) {
			getReviewControl(review.id)?.cancel('Superseded by a newer push.');
		}
	}
}
