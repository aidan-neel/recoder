import type { Review } from '@recoder/shared';
import { apiBase, serverApi } from './server-api';
import { applyProgressMessage, emptyReviewProgress, type ProgressMessage } from './review-progress-state';

/** A session owns its stream, so switching between progress and diff never disconnects it. */
export class ReviewStream {
	progress = $state(emptyReviewProgress(''));
	connection = $state<'connecting' | 'live' | 'reconnecting' | 'closed'>('connecting');
	lastReceived = $state(Date.now());
	private source: EventSource;
	private disposed = false;

	constructor(id: string, onReview: (review: Review) => void) {
		this.progress = emptyReviewProgress(id);
		this.source = new EventSource(`${apiBase}/api/reviews/${id}/events`);
		this.source.onopen = () => {
			this.connection = 'live';
			this.lastReceived = Date.now();
		};
		this.source.onerror = () => { this.connection = 'reconnecting'; };
		this.source.onmessage = (event) => {
			let message: ProgressMessage;
			try { message = JSON.parse(event.data); }
			catch { return; }
			if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
			this.lastReceived = Date.now();
			this.connection = 'live';
			this.progress = applyProgressMessage(this.progress, message);
			if (message.review?.id === id) onReview(message.review);
			const status = message.review?.status ?? message.status ??
				(!message.step && message.type === 'done' ? 'passed' : !message.step && message.type === 'error' ? 'failed' : null);
			if (status !== 'passed' && status !== 'failed') return;
			// Older servers and heartbeat recovery may only provide a status.
			if (!message.review) {
				void serverApi.getReview(id).then((review) => {
					if (!this.disposed) onReview(review);
				}).catch(() => { /* Session polling will retry. */ });
			}
		};
	}

	close(): void {
		this.disposed = true;
		this.source.close();
	}
}
