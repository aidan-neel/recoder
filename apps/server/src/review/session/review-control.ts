import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Cancel and pause for a running review.
 *
 * Cancel aborts the pipeline. Pause stops in-flight model calls (they are
 * re-run on resume, without costing a turn) and holds new ones at
 * `reviewPausePoint`. Deadlines read `reviewNow()`, a clock that stands still
 * while paused, so a long pause doesn't eat the review's time budget.
 * An unattended review (started by a webhook) never stops to ask for approval.
 */
export class ReviewControl {
	readonly abort = new AbortController();
	private pauseController = new AbortController();
	private pausedTotal = 0;
	private pausedAt = 0;
	private waiters: (() => void)[] = [];
	paused = false;
	/** Set while the review waits for the developer to approve a large plan. */
	private approval: { since: number; settle: () => void } | null = null;

	constructor(readonly unattended = false) {}

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

	/** Stop the review; `reason` becomes its failure message. */
	cancel(reason = 'Review cancelled.'): void {
		this.abort.abort(new Error(reason));
		for (const wake of this.waiters.splice(0)) wake();
	}

	pausedMs(): number {
		return (
			this.pausedTotal +
			(this.paused ? Date.now() - this.pausedAt : 0) +
			(this.approval ? Date.now() - this.approval.since : 0)
		);
	}

	/**
	 * Hold until the developer approves the plan, however long that takes. Like
	 * a pause, the wait doesn't count against the review's time. Declining is a
	 * cancel, which also settles the wait so the pipeline unwinds.
	 */
	requestApproval(): Promise<void> {
		if (this.abort.signal.aborted) return Promise.resolve();

		return new Promise((resolve) => {
			const since = Date.now();

			const settle = () => {
				if (this.approval?.settle !== settle) return;
				this.pausedTotal += Date.now() - since;
				this.approval = null;
				resolve();
			};

			this.approval = { since, settle };
			this.abort.signal.addEventListener('abort', settle, { once: true });
		});
	}

	/** The developer said yes; false when nothing is waiting for an answer. */
	approve(): boolean {
		if (!this.approval) return false;
		this.approval.settle();

		return true;
	}

	get awaitingApproval(): boolean {
		return this.approval !== null;
	}

	async wait(signal?: AbortSignal): Promise<void> {
		while (this.paused && !signal?.aborted && !this.abort.signal.aborted) {
			await new Promise<void>((resolve) => {
				const wake = () => {
					signal?.removeEventListener('abort', wake);
					resolve();
				};

				this.waiters.push(wake);
				signal?.addEventListener('abort', wake, { once: true });
			});
		}
	}
}

const controls = new Map<string, ReviewControl>();
const current = new AsyncLocalStorage<ReviewControl>();

export function openReviewControl(reviewId: string, unattended = false): ReviewControl {
	const control = new ReviewControl(unattended);

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
