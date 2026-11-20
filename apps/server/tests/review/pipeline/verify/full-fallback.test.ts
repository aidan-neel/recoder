import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { needsVerifierFallback } from '../../../../src/review/pipeline/verify/full-fallback';

test('exhausted inconclusive and read-only bug proofs get full verification, never a refutation', () => {
	const bug = { category: 'correctness' } as CandidateFinding;

	expect(needsVerifierFallback(bug, true)).toBe(true);
	expect(needsVerifierFallback(bug, false)).toBe(false);
	bug.verification = { status: 'unverified', reason: 'budget ended' };
	expect(needsVerifierFallback(bug, true)).toBe(true);
	bug.verification = { status: 'verified', method: 'trace', reason: 'read' };
	expect(needsVerifierFallback(bug, true)).toBe(true);
	expect(bug.refuted).toBeUndefined();
	bug.verification = { status: 'verified', method: 'run', reason: 'assertion failed' };
	expect(needsVerifierFallback(bug, true)).toBe(false);
	bug.refuted = true;
	expect(needsVerifierFallback(bug, true)).toBe(false);
});
