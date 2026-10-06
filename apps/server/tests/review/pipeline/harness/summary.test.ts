import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { reviewFunnel } from '../../../../src/review/pipeline/harness/summary';
import type { ChangeIntent } from '../../../../src/review/pipeline/intent/types';

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

test('the funnel records which units the brief read, and nothing for a review without a brief', () => {
	const intent = {
		complete: false,
		units: [
			{ id: 'unit-1', title: 'a', paths: ['a.ts'], status: 'included' as const, summary: 's' },
			{ id: 'unit-2', title: 'b', paths: ['b.ts'], status: 'omitted' as const, reason: 'time' as const, summary: '' }
		]
	} as ChangeIntent;

	expect(reviewFunnel({ candidates: [], hidden: [], intent }, 0).brief).toEqual({
		complete: false,
		units: [
			{ id: 'unit-1', status: 'included' },
			{ id: 'unit-2', status: 'omitted', reason: 'time' }
		]
	});

	expect(reviewFunnel({ candidates: [], hidden: [], intent: null }, 0)).not.toHaveProperty('brief');
});
