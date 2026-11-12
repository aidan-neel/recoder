import { REVIEW_POLICY } from '../../session/review-policy.js';
import { reviewNow } from '../../session/review-control.js';
import type { JsonAgentOptions } from './options.js';

/** When an agent started, when it must stop, and when its next turn must be the final one. */
export interface AgentLimits {
	startedAt: number;
	deadlineAt: number;
	finalTurnAt: number;
}

/**
 * When this agent must stop and when its next turn must be the final one.
 * Consolidation time is reserved throughout an investigation, not merely when dispatching it.
 */
export function agentDeadlines<T>(opts: JsonAgentOptions<T>): AgentLimits {
	const startedAt = reviewNow();

	const deadlineAt = Math.min(
		opts.deadlineAt - (opts.consumeReserve ? 0 : REVIEW_POLICY.reserveMsForConsolidation),
		opts.timeLimit ? startedAt + opts.timeLimit.maxWallMs : Infinity
	);

	const finalTurnAt = opts.timeLimit ? startedAt + opts.timeLimit.finalTurnAfterMs : Infinity;

	return { startedAt, deadlineAt, finalTurnAt };
}

/**
 * When a turn's model call must settle, on the review clock. The final turn may run to the agent's deadline. A turn
 * before it that is still running at the final-turn time may go on for half of what is left: a call that is nearly
 * done is not thrown away, and the final turn keeps the other half to answer in. A call stopped there is followed
 * by the final turn, since the final-turn time has passed.
 */
export function callSettleAt(limits: AgentLimits, lastTurn: boolean): number {
	if (lastTurn || limits.finalTurnAt >= limits.deadlineAt) return limits.deadlineAt;

	return limits.finalTurnAt + (limits.deadlineAt - limits.finalTurnAt) / 2;
}

/** Why an agent past its deadline stopped: its own time limit, or the review's. */
export function deadlineError<T>(opts: JsonAgentOptions<T>, limits: AgentLimits): string {
	const ownLimit = opts.timeLimit && limits.deadlineAt === limits.startedAt + opts.timeLimit.maxWallMs;

	return ownLimit
		? `Ran out of time: no answer within ${Math.round(opts.timeLimit!.maxWallMs / 60_000)} minutes`
		: 'Investigation deadline reached; remaining time reserved for consolidation';
}

/** The turns on which this agent may still use tools: all but its answer turns. */
export function toolTurns<T>(opts: JsonAgentOptions<T>): number {
	return opts.maxTurns - (opts.answerTurns ?? 1);
}

/**
 * A unique agent id, which keeps an agent's scratch files and runs its own.
 * Random rather than counted, because run records outlive a server restart in
 * checkpoints and a resumed agent must never share an id with an earlier one.
 */
export function newAgentId(): string {
	return `agent_${crypto.randomUUID()}`;
}
