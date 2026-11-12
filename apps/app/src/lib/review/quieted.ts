import type { Review } from '@recoder/shared';

import { failureText } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { errorToast, undoToast } from '../shell/notify';
import type { ReviewData } from './review-state';
import { syncTab } from './review-tab';

export interface QuietedActions {
	/**
	 * Turns a quieted topic back on, so its findings join the review's
	 * decisions where they rank. Rejects when the server refused, after a
	 * toast has said why. The sample has no server, so it turns back on here
	 * alone.
	 */
	turnTopicBackOn: (topicId: string) => Promise<void>;
}

/** What the quieted actions reach in the review store. */
interface StoreAccess {
	get: () => ReviewData;
	set: (partial: Partial<ReviewData>) => void;
}

/** The ids of the review's findings quieted under `topicId`. */
function quietedIds(review: Review, topicId: string): string[] {
	return review.findings
		.filter((finding) => finding.topic?.id === topicId && finding.topic.quieted)
		.map((finding) => finding.id);
}

/** The review with the topics of the findings in `ids` no longer quieted; every other finding stays the same object. */
function withTopicsOn(review: Review, ids: ReadonlySet<string>): Review {
	return {
		...review,
		findings: review.findings.map((finding) =>
			finding.topic && ids.has(finding.id)
				? { ...finding, topic: { id: finding.topic.id, label: finding.topic.label } }
				: finding
		)
	};
}

/** The server's answer: the ids of this review's findings it turned back on. */
async function unquiet(review: Review, sample: boolean, topicId: string): Promise<string[]> {
	if (sample) return [];

	try {
		return (await reviewsApi.unquiet(review.id, topicId)).unquieted;
	} catch (error) {
		errorToast('Couldn’t turn it back on', failureText(error));

		throw error;
	}
}

/** Turning quieted topics back on in the review on screen. */
export function quietedActions({ get, set }: StoreAccess): QuietedActions {
	return {
		/**
		 * Clears the findings the server turned back on, and any this copy
		 * still holds quieted under the topic, since the server no longer
		 * quiets it; a copy older than the server's would keep them otherwise.
		 */
		async turnTopicBackOn(topicId) {
			const { review, sample } = get();

			if (!review) return;

			const cleared = await unquiet(review, sample, topicId);
			const shown = get().review;

			if (shown?.id !== review.id) return;

			set({ review: withTopicsOn(shown, new Set([...cleared, ...quietedIds(shown, topicId)])) });
			syncTab(get());
			undoToast('Turned back on');
		}
	};
}
