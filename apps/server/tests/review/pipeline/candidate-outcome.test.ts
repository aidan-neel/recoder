import { expect, test } from 'bun:test';
import { candidateOutcome } from '../../../src/review/pipeline/candidate-outcome';
import type { CandidateFinding } from '../../../src/review/pipeline/consolidate';

function candidate(over: Partial<CandidateFinding>): CandidateFinding {
	return { candidateId: 'c1', valid: true, ...over } as CandidateFinding;
}

const verified = { status: 'verified', method: 'trace', reason: 'checked' } as const;

test('a verified candidate held back below the bar stopped at severity but was still verified', () => {
	expect(candidateOutcome(candidate({ belowBar: true, verification: verified }))).toMatchObject({
		stage: 'severity',
		verified: true
	});
});

test('a refuted candidate stopped where the verifier dropped it, and is not verified', () => {
	const refuted = candidate({ valid: false, refuted: true, dropStage: 'refuted', dropReason: 'it is guarded' });

	expect(candidateOutcome(refuted)).toEqual({ stage: 'refuted', reason: 'it is guarded', verified: false });
});

test('a valid candidate no verifier settled stopped as unproven', () => {
	const unsettled = candidate({ verification: { status: 'unverified', reason: 'Not run: out of time.' } });

	expect(candidateOutcome(unsettled)).toEqual({ stage: 'unproven', reason: 'Not run: out of time.', verified: false });
});

test('a candidate below the bar that is published anyway reaches consolidation and says why', () => {
	const published = candidate({ belowBar: true, publishedBy: 'rule', verification: verified });

	expect(candidateOutcome(published)).toEqual({ stage: null, reason: null, verified: true, publishedBy: 'rule' });
});
