import { serverApi } from '../api/server-api';
import { errorToast } from '../shell/notify';
import { threadsStore } from './threads.svelte';

/** The last request of the chain, so a quick Dismiss then Undo reaches the server in that order. */
let pending: Promise<void> = Promise.resolve();

/**
 * Tell the server a finding of the open review was dismissed or restored, so later reviews of the
 * repository learn from it. Demo sessions have no review to tell. A failure only costs the lesson,
 * so it surfaces as a toast and the local state stays.
 */
export function syncDismissal(findingId: string, dismissed: boolean): void {
	const reviewId = threadsStore.reviewId;

	if (!reviewId) return;

	pending = pending.then(async () => {
		try {
			if (dismissed) await serverApi.dismissFinding(reviewId, findingId);
			else await serverApi.restoreFinding(reviewId, findingId);
		} catch (error) {
			errorToast(
				dismissed ? 'Could not save the dismissal' : 'Could not restore the finding',
				error instanceof Error ? error.message : undefined
			);
		}
	});
}
