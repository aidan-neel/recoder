import type { ModelFailure } from '@recoder/shared';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { reviewNow } from '../../session/review-control.js';

export class ReviewAbortedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReviewAbortedError';
	}
}

/** Every model call will fail the same way (signed out, bad key, out of usage): stop the whole review. */
export class ModelBlockedError extends Error {
	constructor(readonly failure: ModelFailure) {
		super(failure.reason);
		this.name = 'ModelBlockedError';
	}
}

export class ModelBudget {
	used = 0;
	constructor(
		/** Raised when the developer approves a plan larger than the baseline. */
		public limit: number = REVIEW_POLICY.maxModelCalls,
		/** Calls held back from ordinary spending; raised while later stages need a guaranteed share. */
		public reserve: number = REVIEW_POLICY.reserveCallsForConsolidation
	) {}

	remaining(): number {
		return Math.max(0, this.limit - this.used);
	}

	canSpend(n = 1, opts?: { consumeReserve?: boolean }): boolean {
		const hold = opts?.consumeReserve ? 0 : this.reserve;

		return this.used + n + hold <= this.limit;
	}

	spend(): void {
		this.used++;
	}

	snapshot(): { used: number; remaining: number; reserved: number; limit: number } {
		return { used: this.used, remaining: this.remaining(), reserved: this.reserve, limit: this.limit };
	}
}

export function canLaunchInvestigation(deadlineAt: number, budget: ModelBudget): boolean {
	return budget.canSpend(1) && reviewNow() + REVIEW_POLICY.reserveMsForConsolidation < deadlineAt;
}

export function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new ReviewAbortedError('review aborted');
}
