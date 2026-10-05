import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { reviewFunnel } from '../../../../src/review/pipeline/harness/summary';

function candidate(over: Partial<CandidateFinding>): CandidateFinding {
	return {
		candidateId: 'c1',
		valid: true,
		belowBar: true,
		verification: { status: 'verified', method: 'rule', reason: 'checked' },
		...over
	} as CandidateFinding;
}

test('a candidate below the bar that is published anyway is verified in the funnel, not dropped at severity', () => {
	const held = candidate({ candidateId: 'c1' });
	const published = candidate({ candidateId: 'c2', publishedBy: 'rule' });
	const funnel = reviewFunnel({ candidates: [held, published], hidden: [] }, 1);

	expect(funnel).toMatchObject({ raised: 2, verified: 1, shown: 1 });
	expect(funnel.dropped.severity).toBe(1);
});
