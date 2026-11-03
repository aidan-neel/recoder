import type { Review } from '@recoder/shared';

import { failureText } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { errorToast } from '../shell/notify';
import { useReview } from './review-store';
import type { ReviewData } from './review-state';

/**
 * True when the shown review can comment on its pull request: a started
 * review of a GitHub or GitLab pull request. The sample has no server, a
 * local repository no pull request page, and a draft nothing to say yet.
 */
export function canComment(state: Pick<ReviewData, 'review' | 'sample'>): boolean {
	const review = state.review;

	if (state.sample || !review || review.status === 'draft') return false;

	return review.source === 'github' || review.source === 'gitlab';
}

/**
 * Write a comment on the pull request, then reload the review so the page
 * shows the new link, or the failure the server saved. A failure toasts the
 * server's reason and rejects, for the button's failure face.
 */
async function commentOnPull(write: (id: string) => Promise<Review>): Promise<void> {
	const { id } = useReview.getState();

	try {
		await write(id);
	} catch (error) {
		errorToast('Couldn’t comment on the pull request', failureText(error));
		void useReview.getState().refresh();
		throw error;
	}

	await useReview.getState().refresh();
}

/** Post the review's summary comment, or bring it up to date. */
export function commentReview(): Promise<void> {
	return commentOnPull((id) => reviewsApi.commentOnPull(id));
}

/** Post one finding on its diff line, or update the comment it has. */
export function commentFinding(findingId: string): Promise<void> {
	return commentOnPull((id) => reviewsApi.commentFinding(id, findingId));
}
