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
	private knownStatus: Review['status'] | undefined;
	private refreshing = false;
	private controller = new AbortController();

	constructor(id: string, onReview: (review: Review) => void) {
		this.progress = emptyReviewProgress(id);
		this.source = new EventSource(`${apiBase}/api/reviews/${id}/events`);
		this.source.onopen = () => {
			if (this.disposed) return;
			this.connection = 'live';
			this.lastReceived = Date.now();
		};
		this.source.onerror = () => { if (!this.disposed) this.connection = 'reconnecting'; };
		this.source.onmessage = (event) => {
			if (this.disposed) return;
			let message: ProgressMessage;
			try { message = JSON.parse(event.data); }
			catch { return; }
			if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
			this.lastReceived = Date.now();
			this.connection = 'live';
			this.progress = applyProgressMessage(this.progress, message);
			if (message.review?.id === id) {
				this.knownStatus = message.review.status;
				onReview(message.review);
			}
			const status = message.review?.status ?? message.status ??
				(!message.step && message.type === 'done' ? 'passed' : !message.step && message.type === 'error' ? 'failed' : null);
			if (status !== 'passed' && status !== 'failed') return;
			// Older servers and heartbeat recovery may only provide a status.
			if (!message.review && status !== this.knownStatus && !this.refreshing) {
				this.refreshing = true;
				void serverApi.getReview(id, AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)])).then((review) => {
					if (!this.disposed) {
						this.knownStatus = review.status;
						onReview(review);
					}
				}).catch(() => { /* Session polling or the next heartbeat will retry. */ })
					.finally(() => { this.refreshing = false; });
			}
		};
	}

	close(): void {
		this.disposed = true;
		this.connection = 'closed';
		this.controller.abort();
		this.source.close();
	}
}
