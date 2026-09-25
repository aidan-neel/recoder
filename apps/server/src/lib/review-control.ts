import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Cancel and pause for a running review.
 *
 * Cancel aborts the pipeline. Pause stops in-flight model calls (they are
 * re-run on resume, without costing a turn) and holds new ones at
 * `reviewPausePoint`. Deadlines read `reviewNow()`, a clock that stands still
 * while paused, so a long pause doesn't eat the review's time budget.
 */
export class ReviewControl {
	readonly abort = new AbortController();
	private pauseController = new AbortController();
	private pausedTotal = 0;
	private pausedAt = 0;
	private waiters: (() => void)[] = [];
	paused = false;

	/** Aborts when a pause starts; renewed on resume. */
	get pauseSignal(): AbortSignal {
		return this.pauseController.signal;
	}

	pause(): boolean {
		if (this.paused || this.abort.signal.aborted) return false;
		this.paused = true;
		this.pausedAt = Date.now();
		this.pauseController.abort();
		return true;
	}

	resume(): boolean {
		if (!this.paused) return false;
		this.paused = false;
		this.pausedTotal += Date.now() - this.pausedAt;
		this.pauseController = new AbortController();
		for (const wake of this.waiters.splice(0)) wake();
		return true;
	}

	cancel(): void {
		this.abort.abort(new Error('Review cancelled'));
		for (const wake of this.waiters.splice(0)) wake();
	}

	pausedMs(): number {
		return this.pausedTotal + (this.paused ? Date.now() - this.pausedAt : 0);
	}

	async wait(signal?: AbortSignal): Promise<void> {
		while (this.paused && !signal?.aborted && !this.abort.signal.aborted) {
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				signal?.addEventListener('abort', () => resolve(), { once: true });
			});
		}
	}
}

const controls = new Map<string, ReviewControl>();
const current = new AsyncLocalStorage<ReviewControl>();

export function openReviewControl(reviewId: string): ReviewControl {
	const control = new ReviewControl();
	controls.set(reviewId, control);
	return control;
}

export function getReviewControl(reviewId: string): ReviewControl | undefined {
	return controls.get(reviewId);
}

export function closeReviewControl(reviewId: string, control: ReviewControl): void {
	if (controls.get(reviewId) === control) controls.delete(reviewId);
}

/** Everything awaited inside `fn` sees this review's control. */
export function runWithReviewControl<T>(control: ReviewControl, fn: () => Promise<T>): Promise<T> {
	return current.run(control, fn);
}

export function currentReviewControl(): ReviewControl | undefined {
	return current.getStore();
}

/** Wall time minus time spent paused: use for every deadline comparison. */
export function reviewNow(): number {
	return Date.now() - (current.getStore()?.pausedMs() ?? 0);
}

/** Hold here while the current review is paused. */
export async function reviewPausePoint(signal?: AbortSignal): Promise<void> {
	await current.getStore()?.wait(signal);
}
