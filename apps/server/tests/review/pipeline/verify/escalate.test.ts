import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { escalates } from '../../../../src/review/pipeline/verify/escalate';
import { restoreEnvAfterEach } from '../obligations/fixtures';

restoreEnvAfterEach(['RECODER_VERIFY_ESCALATE']);

function settled(patch: Partial<CandidateFinding> = {}): CandidateFinding {
	return {
		candidateId: 'c1',
		valid: true,
		category: 'correctness',
		severity: 'warning',
		verification: { status: 'unverified', outcome: 'inconclusive', reason: 'the repro did not run' },
		...patch
	} as never;
}

test('only a first inconclusive verdict on a publishable bug escalates, and only with the flag on', () => {
	delete process.env.RECODER_VERIFY_ESCALATE;
	expect(escalates(settled(), 1)).toBe(false);

	process.env.RECODER_VERIFY_ESCALATE = '1';
	expect(escalates(settled(), 1)).toBe(true);
	expect(escalates(settled(), 2)).toBe(false);
	expect(escalates(settled({ belowBar: true }), 1)).toBe(false);
	expect(escalates(settled({ category: 'readability' }), 1)).toBe(false);
	expect(escalates(settled({ valid: false, refuted: true }), 1)).toBe(false);
	expect(escalates(settled({ verification: { status: 'verified', method: 'run', reason: 'ran' } }), 1)).toBe(false);
});
