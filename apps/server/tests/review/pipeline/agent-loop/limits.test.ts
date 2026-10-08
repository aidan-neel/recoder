import { expect, test } from 'bun:test';
import { FROZEN_AT, advanceClock, freezeClockEachTest } from '../../../helpers/manual-clock';
import { agentDeadlines } from '../../../../src/review/pipeline/agent-loop/limits';
import type { JsonAgentOptions } from '../../../../src/review/pipeline/agent-loop/options';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';

freezeClockEachTest();

const REVIEW_DEADLINE = FROZEN_AT + 600_000;
const reviewLimit = REVIEW_DEADLINE - REVIEW_POLICY.reserveMsForConsolidation;

/** The limits of an agent starting now under a review that ends at `REVIEW_DEADLINE`, with the given time limit. */
const limitsOf = (timeLimit: JsonAgentOptions<unknown>['timeLimit']) =>
	agentDeadlines({ deadlineAt: REVIEW_DEADLINE, timeLimit } as JsonAgentOptions<unknown>);

test('without a clock of its own an agent is limited from when it started, whatever happens after', () => {
	const limits = limitsOf({ finalTurnAfterMs: 30_000, maxWallMs: 45_000 });

	advanceClock(60_000);

	expect(limits.deadlineAt).toBe(FROZEN_AT + 45_000);
	expect(limits.finalTurnAt).toBe(FROZEN_AT + 30_000);
	expect(limits.settleAt).toBe(FROZEN_AT + 45_000);
});

test("an agent on its own clock is limited by that clock's time, and its prompts by the review's deadline", () => {
	let elapsed = 0;
	const limits = limitsOf({ finalTurnAfterMs: 30_000, maxWallMs: 45_000, elapsed: () => elapsed });

	advanceClock(60_000);
	elapsed = 5_000;

	expect(limits.deadlineAt).toBe(FROZEN_AT + 60_000 + 40_000);
	expect(limits.finalTurnAt).toBe(FROZEN_AT + 60_000 + 25_000);
	expect(limits.settleAt).toBe(reviewLimit);

	advanceClock(reviewLimit - 1_000 - Date.now());

	expect(limits.deadlineAt).toBe(reviewLimit);
});

test('an agent without a time limit stops at the review deadline less the consolidation reserve', () => {
	const limits = limitsOf(undefined);

	expect(limits.deadlineAt).toBe(reviewLimit);
	expect(limits.finalTurnAt).toBe(Infinity);
	expect(limits.settleAt).toBe(reviewLimit);
});
