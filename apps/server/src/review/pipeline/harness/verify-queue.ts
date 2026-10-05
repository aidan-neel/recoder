import { findingKind } from '@recoder/shared';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY, verifierTurns } from '../../session/review-policy.js';
import { canLaunchInvestigation } from '../agent-loop.js';
import type { CandidateFinding } from '../consolidate.js';
import { isMutationFinding } from '../verify/runs.js';
import { publishBudget, saveCheckpoint, syncWorkspaceDeadline, type ReviewRun } from './context.js';

/** One attempt at settling a candidate; false when the verifier gave no verdict. */
type VerifyAttempt = (candidate: CandidateFinding, attempt: number) => Promise<boolean>;

interface QueuedAttempt {
	candidate: CandidateFinding;
	attempt: number;
}

/** A verifier that errors or stops before a verdict runs once more, after every waiting first attempt. */
const VERIFIER_ATTEMPTS = 2;

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

const NOT_RUN = 'Not run: the review ran out of time or model calls before verifying this.';

/**
 * Where an attempt stands in line: candidates that can be published before
 * those held back for being below the reporting bar, then first attempts,
 * then bugs, then the most severe.
 */
function rank({ candidate, attempt }: QueuedAttempt): number[] {
	return [
		Number(candidate.belowBar === true),
		attempt,
		Number(findingKind(candidate.category) === 'quality'),
		SEVERITY_ORDER[candidate.severity] ?? 3
	];
}

function compareRank(a: QueuedAttempt, b: QueuedAttempt): number {
	const [left, right] = [rank(a), rank(b)];

	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3];
}

/**
 * The verifiers of one review. A candidate joins as soon as its reviewer
 * reports it, so verification runs alongside the reviewers still working
 * instead of after the last one. Each candidate brings its own model calls and
 * time: the budget and deadline grow as it joins. A few run at once; the next
 * is always the best waiting one, bugs before quality and most severe first.
 */
export class VerifyQueue {
	private readonly waiting: QueuedAttempt[] = [];

	private running = 0;

	private accepted = 0;

	/** The error that stopped the queue: a blocked model or an aborted review. */
	private failure: { error: unknown } | null = null;

	private readonly idleWaiters: (() => void)[] = [];

	constructor(
		private readonly run: ReviewRun,
		private readonly verify: VerifyAttempt
	) {}

	/** Whether any verifier is running or waiting. */
	get busy(): boolean {
		return this.running > 0 || this.waiting.length > 0;
	}

	/** Queues a candidate that is valid and has no verdict yet; any other is left as it is. */
	add(candidate: CandidateFinding): void {
		if (!candidate.valid || candidate.verification) return;

		if (!this.takeSlot(candidate)) {
			candidate.verification = {
				status: 'unverified',
				reason: `Not run: this review already verified ${REVIEW_POLICY.maxVerifications} findings.`
			};

			return;
		}

		this.waiting.push({ candidate, attempt: 1 });
		this.makeRoom(verifierTurns(isMutationFinding(candidate, this.run.workspace !== null)));
		this.launch();
	}

	/**
	 * Claims one of the review's verifications for the candidate. Once they are
	 * all taken, a candidate that can be published bumps a held-back one still
	 * waiting for its first attempt; a held-back one never bumps anything.
	 */
	private takeSlot(candidate: CandidateFinding): boolean {
		if (this.accepted < REVIEW_POLICY.maxVerifications) {
			this.accepted++;

			return true;
		}

		const bumped = candidate.belowBar
			? -1
			: this.waiting.findIndex((item) => item.candidate.belowBar && item.attempt === 1);

		if (bumped === -1) return false;

		const displaced = this.waiting.splice(bumped, 1)[0].candidate;

		delete displaced.publishedBy;

		displaced.verification = {
			status: 'unverified',
			reason: 'Not run: findings that can be published were verified first.'
		};

		return true;
	}

	/** Resolves once every queued verifier has finished; rethrows what stopped the queue. */
	async drain(): Promise<void> {
		if (this.busy) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
		if (this.failure) throw this.failure.error;
	}

	/**
	 * Grows the budget by one verifier's `turns` and moves the deadline to fit
	 * everything in line. A review already out of time stays out of time.
	 */
	private makeRoom(turns: number): void {
		const { run } = this;

		if (reviewNow() >= run.deadlineAt) return;

		const waves = Math.ceil((this.waiting.length + this.running) / REVIEW_POLICY.maxConcurrentVerifications);

		run.budget.limit += turns;

		run.deadlineAt = Math.max(
			run.deadlineAt,
			reviewNow() + waves * REVIEW_POLICY.msPerVerificationWave + REVIEW_POLICY.reserveMsForConsolidation
		);

		syncWorkspaceDeadline(run);
		publishBudget(run);
	}

	/** Starts waiting attempts while there is a free verifier. */
	private launch(): void {
		while (this.running < REVIEW_POLICY.maxConcurrentVerifications && this.waiting.length) {
			const next = this.waiting.reduce((best, item) => (compareRank(item, best) < 0 ? item : best));

			this.waiting.splice(this.waiting.indexOf(next), 1);
			this.running++;

			this.attempt(next)
				.catch((error: unknown) => this.stop(error))
				.finally(() => this.finished());
		}
	}

	private async attempt({ candidate, attempt }: QueuedAttempt): Promise<void> {
		const { run } = this;

		if (this.failure || run.controller.signal.aborted || !canLaunchInvestigation(run.deadlineAt, run.budget)) {
			if (attempt === 1) candidate.verification = { status: 'unverified', reason: NOT_RUN };

			return;
		}

		const settled = await this.verify(candidate, attempt);

		if (!settled && attempt < VERIFIER_ATTEMPTS) this.waiting.push({ candidate, attempt: attempt + 1 });

		saveCheckpoint(run);
	}

	/** Keeps the first error; attempts still waiting then end unverified instead of starting. */
	private stop(error: unknown): void {
		this.failure ??= { error };
	}

	private finished(): void {
		this.running--;
		this.launch();

		if (!this.busy) for (const resolve of this.idleWaiters.splice(0)) resolve();
	}
}
