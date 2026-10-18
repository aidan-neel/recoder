import { REVIEW_CANCELLED, type PullRequest, type Review, type ReviewProgress } from '@recoder/shared';
import { toast } from '@recoder/ui';

import { ApiError, failureText, plainly } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { errorToast, undoToast } from '../shell/notify';
import { useShell } from '../shell/shell-store';
import { useReview } from './review-store';

/**
 * Where a review stands. `paused` is a running review held by the person;
 * `cancelled` is a failed review they stopped on purpose.
 */
export type ReviewPhase = 'draft' | 'queued' | 'running' | 'paused' | 'passed' | 'failed' | 'cancelled';

/** The review's phase, from its stored status and the live progress. */
export function phaseOf(review: Review, progress: ReviewProgress | null): ReviewPhase {
	if (review.status === 'running' && progress?.paused) return 'paused';
	if (review.status === 'failed' && review.summary === REVIEW_CANCELLED) return 'cancelled';

	return review.status;
}

/**
 * True when commits landed after the review. A failed review of an old commit
 * is reviewed again rather than continued, so the new head gets reviewed.
 */
export function isOutdated(review: Review, pull: PullRequest | null): boolean {
	return !!pull?.headSha && review.headSha !== 'unknown' && review.headSha !== pull.headSha;
}

/** True when the review is the sample, which has no server behind it. */
function isSample(review: Review): boolean {
	const { sample, review: shown } = useReview.getState();

	return sample && shown?.id === review.id;
}

/** Says the sample cannot do this and changes nothing. Returns true when the review is the sample. */
function sampleOnly(review: Review, verb: string): boolean {
	if (!isSample(review)) return false;

	toast(`${verb} needs a real review`, { description: 'Track a repository to review your own pull requests.' });

	return true;
}

/** Runs one server call. A failure toasts what went wrong in plain words, with any way out the server offered, and rethrows. */
async function call<T>(failure: string, action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		errorToast(failure, failureText(error), error instanceof ApiError ? error.action : undefined);

		throw error;
	}
}

/** Re-reads the review when the page shows it, so the change lands before the stream reports it. */
async function refreshShown(review: Review): Promise<void> {
	const store = useReview.getState();

	if (store.id === review.id) await store.refresh();
}

/** Shows a pause or resume at once; the stream's next event confirms it. */
function markPaused(review: Review, paused: boolean): void {
	useReview.setState((state) =>
		state.id === review.id && state.progress ? { progress: { ...state.progress, paused } } : {}
	);
}

/**
 * The review lifecycle: each action calls the server, refreshes the review
 * store and toasts its outcome. Each rejects on failure, so a `Button` with
 * `status` can show it. On the sample, each says it needs a real review.
 */
export const lifecycle = {
	async pause(review: Review): Promise<void> {
		if (sampleOnly(review, 'Pausing')) return;

		await call('Couldn’t pause the review', () => reviewsApi.pause(review.id));
		markPaused(review, true);
	},

	async resume(review: Review): Promise<void> {
		if (sampleOnly(review, 'Resuming')) return;

		await call('Couldn’t resume the review', () => reviewsApi.resume(review.id));
		markPaused(review, false);
	},

	async cancel(review: Review): Promise<void> {
		if (sampleOnly(review, 'Cancelling')) return;

		await call('Couldn’t cancel the review', () => reviewsApi.cancel(review.id));
		await refreshShown(review);
		undoToast('Review cancelled');
	},

	/** Resumes a failed review from its last checkpoint. */
	async continue(review: Review): Promise<void> {
		if (sampleOnly(review, 'Continuing')) return;

		await call('Couldn’t continue the review', () => reviewsApi.continue(review.id));
		await refreshShown(review);
	},

	/** Runs a draft session's full review. */
	async start(review: Review): Promise<void> {
		if (sampleOnly(review, 'Starting a review')) return;

		await call('Couldn’t start the review', () => reviewsApi.startDraft(review.id));
		await refreshShown(review);
	},

	/**
	 * Queues a fresh review of the pull request's current head and resolves
	 * with it, so the page can open it. The old review's tab closes.
	 */
	async again(review: Review): Promise<Review> {
		if (sampleOnly(review, 'Reviewing again')) return review;

		const store = useReview.getState();
		const pull = store.id === review.id ? store.pull : null;
		const target = pull ?? { number: review.prNumber, title: review.prTitle ?? undefined };
		const fresh = await call('Couldn’t start the review', () => reviewsApi.start(review.repoId, target));

		useShell.getState().closeTabs([review.id]);

		return fresh;
	},

	/**
	 * Deletes the review, closes its tab and goes back to the queue. The
	 * confirm dialog shows a failure, so it rejects with plain text and no toast.
	 */
	async remove(review: Review): Promise<void> {
		if (sampleOnly(review, 'Deleting')) return;

		await plainly(() => reviewsApi.remove(review.id));
		useShell.getState().closeTabs([review.id]);
		useShell.getState().navigate('/');
		undoToast('Review deleted');
	}
};
