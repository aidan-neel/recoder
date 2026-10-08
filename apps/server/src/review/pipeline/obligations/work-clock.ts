import type { QueueWatcher } from '../../../sandbox/exec-workspace.js';
import { reviewClock } from '../../session/review-control.js';

/**
 * An investigation's working time: review-clock time since it started, less
 * the time its sandbox calls waited behind other agents' calls in the
 * workspace queue. The clock stops while one of its calls waits and none of
 * its own runs, so a call queued behind its own earlier call is still work.
 * The workspace may report from outside the review's async context, so the
 * clock is bound to the review it was made in.
 */
export class WorkClock implements QueueWatcher {
	private readonly now = reviewClock();
	private readonly startedAt = this.now();
	private waiting = 0;
	private running = 0;
	private stoppedAt: number | null = null;
	private waited = 0;

	queued(): void {
		this.waiting++;
		this.update();
	}

	started(): void {
		this.waiting--;
		this.running++;
		this.update();
	}

	finished(): void {
		this.running--;
		this.update();
	}

	/** Time since it started, less the queue wait: what the time box measures. */
	workingMs(): number {
		return this.reading().workingMs;
	}

	/** Elapsed, queued and working time read at one instant, so working is exactly elapsed less queued. */
	reading(): { elapsedMs: number; queuedMs: number; workingMs: number } {
		const now = this.now();
		const queuedMs = this.waited + (this.stoppedAt === null ? 0 : now - this.stoppedAt);
		const elapsedMs = now - this.startedAt;

		return { elapsedMs, queuedMs, workingMs: elapsedMs - queuedMs };
	}

	private update(): void {
		const stopped = this.waiting > 0 && this.running === 0;

		if (stopped && this.stoppedAt === null) this.stoppedAt = this.now();

		if (!stopped && this.stoppedAt !== null) {
			this.waited += this.now() - this.stoppedAt;
			this.stoppedAt = null;
		}
	}
}
