import { describe, expect, test } from 'bun:test';
import type { Finding, Review, ReviewFunnel } from '@recoder/shared';

import { bugLists } from '../../src/lib/bugs/bug-lists';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';

const FUNNEL: ReviewFunnel = {
	raised: 6,
	dropped: { location: 0, evidence: 0, category: 0, severity: 0, dismissed: 0, refuted: 0, covered: 0 },
	unproven: 1,
	verified: 3,
	notRun: 2,
	shown: 3
};

const UNPROVEN: Finding = { id: 'u1', file: 'src/a.ts', line: 3, severity: 'warning', message: 'Might double count.' };

function review(change: Partial<Review> = {}): Review {
	return { ...SAMPLE_REVIEW, unconfirmed: [UNPROVEN], funnel: FUNNEL, ...change };
}

describe('bugLists', () => {
	test('open questions, unproven claims and checks that never ran are listed apart and never count as findings', () => {
		const lists = bugLists(review(), {});

		expect(lists.open.map((bug) => bug.id)).toEqual(SAMPLE_REVIEW.findings.map((finding) => finding.id));
		expect(lists.open.some((bug) => bug.id === 'u1')).toBe(false);

		expect(lists.unresolved.map((item) => [item.id, item.kind])).toEqual([
			['question:Q1', 'question'],
			['unconfirmed:u1', 'question'],
			['prerequisite:checks', 'prerequisite']
		]);
	});

	test('the checked line counts the questions investigated and those disproved', () => {
		expect(bugLists(review(), {}).checked).toEqual({ claims: 6, cleared: 5 });
	});

	test('a decided finding leaves the open list for the decided one, and a quieted topic hides it from both', () => {
		const [first, second, ...rest] = SAMPLE_REVIEW.findings;
		const decided: Finding = { ...first, decision: { state: 'accepted', decidedAt: '2026-10-13T10:00:00.000Z' } };
		const quieted: Finding = { ...second, topic: { id: 't1', label: 'Naming', quieted: true } };
		const lists = bugLists(review({ findings: [decided, quieted, ...rest] }), {});

		expect(lists.open.map((bug) => bug.id)).toEqual(rest.map((finding) => finding.id));
		expect(lists.decided.map((bug) => bug.id)).toEqual([first.id]);
		expect(lists.quieted.map((bug) => bug.id)).toEqual([second.id]);
	});

	test('the duration runs from the review’s start to its last update', () => {
		expect(
			bugLists(review({ startedAt: '2026-10-13T09:00:00.000Z', updatedAt: '2026-10-13T09:06:40.000Z' }), {}).duration
		).toBe('6m 40s');
	});
});
