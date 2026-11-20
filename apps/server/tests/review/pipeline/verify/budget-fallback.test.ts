import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { needsBudgetFallback } from '../../../../src/review/pipeline/verify/budget-fallback';

test('exhausted inconclusive and read-only bug proofs get full verification, never a refutation', () => {
	const bug = { category: 'correctness' } as CandidateFinding;

	expect(needsBudgetFallback(bug, true)).toBe(true);
	expect(needsBudgetFallback(bug, false)).toBe(false);
	bug.verification = { status: 'unverified', reason: 'budget ended' };
	expect(needsBudgetFallback(bug, true)).toBe(true);
	bug.verification = { status: 'verified', method: 'trace', reason: 'read' };
	expect(needsBudgetFallback(bug, true)).toBe(true);
	expect(bug.refuted).toBeUndefined();
	bug.verification = { status: 'verified', method: 'run', reason: 'assertion failed' };
	expect(needsBudgetFallback(bug, true)).toBe(false);
	bug.refuted = true;
	expect(needsBudgetFallback(bug, true)).toBe(false);
});
