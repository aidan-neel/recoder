import { expect, test } from 'bun:test';
import { brokeInSetup, failedOnTarget } from '../../../../src/review/pipeline/verify/runs';
import { baseRecord } from '../../../../src/review/pipeline/verify/baseline';

const MOVED = "error: Cannot find module './limits' from '/repo/src/queue.ts'";

test('a run recorded as a failed assertion is trusted over a missing module in its output', () => {
	const recorded = { ...baseRecord('bun test', 1, MOVED), outcome: 'assertion-failed' as const };

	expect(brokeInSetup(recorded)).toBe(false);
	expect(failedOnTarget(recorded)).toBe(true);
});

test('a run with no recorded outcome that misses a module still stopped in setup', () => {
	const unrecorded = { ...baseRecord('bun test', 1, MOVED), outcome: undefined };

	expect(brokeInSetup(unrecorded)).toBe(true);
	expect(failedOnTarget(unrecorded)).toBe(false);
});
