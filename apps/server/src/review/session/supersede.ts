import { db } from '../../store';
import { getReviewControl } from './review-control';

/**
 * A newer push or mention makes an automatic review (webhook or watcher) of
 * the same PR stale, so it is cancelled instead of running beside the new
 * one. Reviews a developer started are left alone.
 */
export function supersedeAutomaticReviews(repoId: string, prNumber: number): void {
	for (const review of db.reviews.list()) {
		const samePr = review.repoId === repoId && review.prNumber === prNumber;
		const inFlight = review.status === 'queued' || review.status === 'running';

		if (review.trigger && samePr && inFlight) {
			getReviewControl(review.id)?.cancel('Superseded by a newer automatic review.');
		}
	}
}
