import { findingKind } from '@recoder/shared';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY, verifierTurns } from '../../session/review-policy.js';
import { canLaunchInvestigation } from '../agent-loop.js';
import { isNotRun, type CandidateFinding } from '../consolidate.js';
import { sameIssue } from '../consolidate-merge.js';
import { isMutationFinding } from '../verify/runs.js';
import { publishBudget, saveCheckpoint, syncWorkspaceDeadline, type ReviewRun } from './context.js';

/** One attempt at settling a candidate; false when the verifier gave no verdict. */
type VerifyAttempt = (candidate: CandidateFinding, attempt: number) => Promise<boolean>;

/** A rejected candidate's one repair; true when it passed validation again and is to be verified. */
type RepairAttempt = (candidate: CandidateFinding) => Promise<boolean>;

/** Gives `follower` the verdict a verifier proved for `leader`, which claims the same issue. */
type ShareVerdict = (follower: CandidateFinding, leader: CandidateFinding) => void;

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

	/** Repairs still running; a candidate one makes valid joins the line when it finishes. */
	private repairing = 0;

	/** The model calls each candidate added to the budget when it joined. */
	private readonly room = new Map<CandidateFinding, number>();

	/** Bugs whose verifier is waiting or running, in the order they joined; a later report of one waits for it. */
	private readonly leaders: CandidateFinding[] = [];

	/** Reports waiting for a leader's verdict instead of a verifier of their own. */
	private readonly followers = new Map<CandidateFinding, CandidateFinding[]>();

	/** The error that stopped the queue: a blocked model or an aborted review. */
	private failure: { error: unknown } | null = null;

	private readonly idleWaiters: (() => void)[] = [];

	constructor(
		private readonly run: ReviewRun,
		private readonly verify: VerifyAttempt,
		private readonly repair?: RepairAttempt,
		private readonly share?: ShareVerdict
	) {}

	/** Whether any verifier or repair is running or waiting. */
	get busy(): boolean {
		return this.running > 0 || this.waiting.length > 0 || this.repairing > 0;
	}

	/**
	 * Queues a candidate that is valid and has no verdict yet. A rejected one
	 * goes to its repair first, when the queue has one, and joins if the repair
	 * makes it valid; any other is left as it is. A bug that claims the same
	 * issue as one already being verified waits for that verdict instead.
	 */
	add(candidate: CandidateFinding): void {
		if (!candidate.valid && this.repair) {
			this.startRepair(this.repair, candidate);

			return;
		}

		if (!candidate.valid || candidate.verification || this.follow(candidate)) return;

		if (!this.takeSlot(candidate)) {
			candidate.verification = {
				status: 'unverified',
				reason: `Not run: this review already verified ${REVIEW_POLICY.maxVerifications} findings.`
			};

			return;
		}

		this.waiting.push({ candidate, attempt: 1 });
		this.room.set(candidate, this.makeRoom(verifierTurns(isMutationFinding(candidate, this.run.workspace !== null))));

		if (this.canLead(candidate)) {
			this.leaders.push(candidate);
			this.followers.set(candidate, []);
		}

		this.launch();
	}

	/**
	 * A bug report can share a verifier: consolidation merges reports of one
	 * issue, so one proof covers them all. Weak-test findings plant their own
	 * bug, so they never share. A report below the reporting bar is verified
	 * last, so it shares only with another below the bar ({@link follow}).
	 */
	private canLead(candidate: CandidateFinding): boolean {
		return (
			this.share !== undefined &&
			findingKind(candidate.category) === 'bug' &&
			!isMutationFinding(candidate, this.run.workspace !== null)
		);
	}

	/**
	 * Waits for the verifier of a leader that claims the same issue, or takes
	 * its verdict at once when that verifier already proved it. False when no
	 * leader is waiting, running or proved, so the candidate gets its own.
	 */
	private follow(candidate: CandidateFinding): boolean {
		if (!this.canLead(candidate)) return false;

		const leader = this.leaders.find(
			(other) =>
				Boolean(other.belowBar) === Boolean(candidate.belowBar) &&
				(this.followers.has(other) || proved(other)) &&
				sameIssue(other, candidate, this.run.inventory)
		);

		if (!leader) return false;

		if (proved(leader)) this.share!(candidate, leader);
		else this.followers.get(leader)!.push(candidate);

		return true;
	}

	/**
	 * A leader's verifier is done. Its followers take a proof; with no proof
	 * (unverified, refuted, not run) each joins the queue for a verifier of
	 * its own, so a report is never dropped on another's verdict.
	 */
	private release(leader: CandidateFinding): void {
		const waiting = this.followers.get(leader) ?? [];

		this.followers.delete(leader);

		for (const follower of waiting) {
			if (proved(leader)) this.share!(follower, leader);
			else this.add(follower);
		}
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

		this.release(displaced);

		return true;
	}

	/** Resolves once every queued verifier has finished; rethrows what stopped the queue. */
	async drain(): Promise<void> {
		if (this.busy) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
		if (this.failure) throw this.failure.error;
	}

	/**
	 * Grows the budget by one verifier's `turns` and moves the deadline to fit
	 * everything in line, and returns the calls it added. A review already out
	 * of time stays out of time.
	 */
	private makeRoom(turns: number): number {
		const { run } = this;

		if (reviewNow() >= run.deadlineAt) return 0;

		const waves = Math.ceil((this.waiting.length + this.running) / REVIEW_POLICY.maxConcurrentVerifications);

		run.budget.limit += turns;

		run.deadlineAt = Math.max(
			run.deadlineAt,
			reviewNow() + waves * REVIEW_POLICY.msPerVerificationWave + REVIEW_POLICY.reserveMsForConsolidation
		);

		syncWorkspaceDeadline(run);
		publishBudget(run);

		return turns;
	}

	/**
	 * A bug no verifier tried, because no code could run, frees its slot and
	 * takes back the model calls it added, so the budget grows only for
	 * verifiers that run. The deadline keeps its room.
	 */
	private handBack(candidate: CandidateFinding): void {
		this.accepted--;
		this.run.budget.limit -= this.room.get(candidate) ?? 0;
		this.room.delete(candidate);
		publishBudget(this.run);
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
			this.release(candidate);

			return;
		}

		const settled = await this.verify(candidate, attempt);

		if (isNotRun(candidate)) this.handBack(candidate);
		if (!settled && attempt < VERIFIER_ATTEMPTS) this.waiting.push({ candidate, attempt: attempt + 1 });
		else this.release(candidate);

		saveCheckpoint(run);
	}

	private startRepair(repair: RepairAttempt, candidate: CandidateFinding): void {
		this.repairing++;

		repair(candidate)
			.then((valid) => {
				if (valid && !this.failure) this.add(candidate);
			})
			.catch((error: unknown) => this.stop(error))
			.finally(() => {
				this.repairing--;
				this.settleIdle();
			});
	}

	/** Keeps the first error; attempts still waiting then end unverified instead of starting. */
	private stop(error: unknown): void {
		this.failure ??= { error };
	}

	private finished(): void {
		this.running--;
		this.launch();
		this.settleIdle();
	}

	private settleIdle(): void {
		if (!this.busy) for (const resolve of this.idleWaiters.splice(0)) resolve();
	}
}

/** A candidate a verifier proved, still valid. */
function proved(candidate: CandidateFinding): boolean {
	return candidate.valid && candidate.verification?.status === 'verified';
}
