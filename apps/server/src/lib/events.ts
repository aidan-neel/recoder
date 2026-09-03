/**
 * In-memory per-review event bus backing the SSE endpoint.
 * Events are ephemeral (no replay): the client also polls review status,
 * so a dropped connection just resumes on reconnect.
 */

export interface ReviewEvent {
	type: 'step' | 'log' | 'done' | 'error';
	/** Machine step name, e.g. `fetch`, `sandbox`, `agent:security`. */
	step?: string;
	message: string;
	/** Structured payload, e.g. `{ agent: 'security', status: 'done', findings: 2 }`. */
	data?: Record<string, unknown>;
	at: string;
}

type Listener = (event: ReviewEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function emitReviewEvent(reviewId: string, event: Omit<ReviewEvent, 'at'>): void {
	const message: ReviewEvent = { ...event, at: new Date().toISOString() };
	listeners.get(reviewId)?.forEach((fn) => {
		try {
			fn(message);
		} catch {
			// Listener failures must never break the pipeline.
		}
	});
}

export function subscribeReview(reviewId: string, fn: Listener): () => void {
	let set = listeners.get(reviewId);
	if (!set) {
		set = new Set();
		listeners.set(reviewId, set);
	}
	set.add(fn);
	return () => {
		set.delete(fn);
		if (set.size === 0) listeners.delete(reviewId);
	};
}

export function listenerCount(reviewId: string): number {
	return listeners.get(reviewId)?.size ?? 0;
}
