import { emptyReviewProgress, type Review, type ReviewProgress } from '@recoder/shared';
import type { ReviewEvent } from '../../review/session/events';
import { db, reviewProgress } from '../../store';

export const EVENT_HEARTBEAT_MS = 5000;

/**
 * The snapshot a client gets. Without `tools` it leaves out the tool-call
 * history, which can pass a megabyte and which a client that never shows it
 * would download again on every connect.
 */
function snapshotFor(progress: ReviewProgress | undefined, tools: boolean): ReviewProgress | undefined {
	if (tools || !progress) return progress;

	const { toolCalls: _toolCalls, ...rest } = progress;

	return rest;
}

export class ReviewEventPayloads {
	private lastStatus: Review['status'];

	/** `tools` false leaves the tool calls out of every snapshot this stream sends. */
	constructor(
		private readonly review: Review,
		private readonly tools: boolean
	) {
		this.lastStatus = review.status;
	}

	get reviewId(): string {
		return this.review.id;
	}

	async snapshot() {
		const snapshot =
			snapshotFor(await reviewProgress.get(this.review.id), this.tools) ?? emptyReviewProgress(this.review.id);

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
					...(terminal || restarted
						? { snapshot: snapshotFor(await reviewProgress.get(this.review.id), this.tools) }
						: {})
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
