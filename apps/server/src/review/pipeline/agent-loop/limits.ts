import { REVIEW_POLICY } from '../../session/review-policy.js';
import { reviewNow } from '../../session/review-control.js';
import type { JsonAgentOptions } from './options.js';

/** When an agent must stop and when its next turn must be the final one. */
export interface AgentLimits {
	readonly deadlineAt: number;
	readonly finalTurnAt: number;
	/**
	 * How long one wait on the model (a prompt that runs tools) may last. It is
	 * `deadlineAt`, except for an agent on its own clock: that clock stops while
	 * its tool calls queue, so its limit moves on and only the review's holds.
	 */
	readonly settleAt: number;
}

/**
 * The review's deadline as this agent sees it: consolidation time is reserved
 * throughout an investigation, not merely when dispatching it.
 */
function reviewDeadline<T>(opts: JsonAgentOptions<T>): number {
	return opts.deadlineAt - (opts.consumeReserve ? 0 : REVIEW_POLICY.reserveMsForConsolidation);
}

/**
 * When this agent must stop and when its next turn must be the final one. An
 * agent with its own `timeLimit.elapsed` clock has both limits read off that
 * clock each time they are asked for, so they move while it is paused.
 */
export function agentDeadlines<T>(opts: JsonAgentOptions<T>): AgentLimits {
	const startedAt = reviewNow();
	const limit = opts.timeLimit;
	const review = reviewDeadline(opts);
	const elapsed = limit?.elapsed;
	const at = (ms: number) => (elapsed ? reviewNow() + ms - elapsed() : startedAt + ms);

	return {
		get deadlineAt() {
			return Math.min(review, limit ? at(limit.maxWallMs) : Infinity);
		},
		get finalTurnAt() {
			return limit ? at(limit.finalTurnAfterMs) : Infinity;
		},
		get settleAt() {
			return elapsed ? review : this.deadlineAt;
		}
	};
}

/** Why an agent past its deadline stopped: its own time limit, or the review's. */
export function deadlineError<T>(opts: JsonAgentOptions<T>, limits: AgentLimits): string {
	const ownLimit = opts.timeLimit && limits.deadlineAt < reviewDeadline(opts);

	return ownLimit
		? `Ran out of time: no answer within ${Math.round(opts.timeLimit!.maxWallMs / 60_000)} minutes`
		: 'Investigation deadline reached; remaining time reserved for consolidation';
}

/**
 * A unique agent id, which keeps an agent's scratch files and runs its own.
 * Random rather than counted, because run records outlive a server restart in
 * checkpoints and a resumed agent must never share an id with an earlier one.
 */
export function newAgentId(): string {
	return `agent_${crypto.randomUUID()}`;
}
