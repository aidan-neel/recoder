import { emptyReviewProgress, type Review } from '@recoder/shared';
import type { ReviewEvent } from '../../review/session/events';
import { db, reviewProgress } from '../../store';

export const EVENT_HEARTBEAT_MS = 5000;

export class ReviewEventPayloads {
	private lastStatus: Review['status'];

	constructor(private readonly review: Review) {
		this.lastStatus = review.status;
	}

	async snapshot() {
		const snapshot = (await reviewProgress.get(this.review.id)) ?? emptyReviewProgress(this.review.id);
		const review = await db.reviews.get(this.review.id);

		this.lastStatus = review?.status ?? this.lastStatus;

		return { type: 'snapshot', snapshot, review, status: this.lastStatus, sequence: snapshot.sequence };
	}

	async event(event: ReviewEvent) {
		const terminal = !event.step && (event.type === 'done' || event.type === 'error');
		const restarted = event.data?.reset === true;
		const current = await db.reviews.get(this.review.id);
		const statusChanged = current?.status !== this.lastStatus;

		if (current) this.lastStatus = current.status;

		return terminal || restarted || statusChanged
			? {
					...event,
					review: current,
					...(terminal || restarted ? { snapshot: await reviewProgress.get(this.review.id) } : {})
				}
			: event;
	}

	async heartbeat() {
		return {
			type: 'heartbeat',
			at: new Date().toISOString(),
			status: (await db.reviews.get(this.review.id))?.status ?? this.lastStatus
		};
	}
}
