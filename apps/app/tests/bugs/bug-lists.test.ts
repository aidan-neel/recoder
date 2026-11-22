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

/** The ids of `items` in id order, so a list is compared by what it holds, not by how it sorts. */
function ids(items: { id: string }[]): string[] {
	return items.map((item) => item.id).sort();
}

function review(change: Partial<Review> = {}): Review {
	return { ...SAMPLE_REVIEW, unconfirmed: [UNPROVEN], funnel: FUNNEL, ...change };
}

describe('bugLists', () => {
	test('open questions, unproven claims and checks that never ran are listed apart and never count as findings', () => {
		const lists = bugLists(review(), {});

		expect(ids(lists.open)).toEqual(ids(SAMPLE_REVIEW.findings.filter((finding) => finding.tier !== 'fyi')));
		expect(ids(lists.fyi)).toEqual(ids(SAMPLE_REVIEW.findings.filter((finding) => finding.tier === 'fyi')));
		expect(lists.open.some((bug) => bug.id === 'u1')).toBe(false);

		expect(lists.unresolved.map((item) => [item.id, item.kind])).toEqual([
			['question:Q1', 'question'],
			['unconfirmed:u1', 'question'],
			['prerequisite:checks', 'prerequisite']
		]);
	});

	test('the checked line counts the questions investigated and those disproved', () => {
		expect(bugLists(review(), {}).checked).toEqual({ claims: 6, cleared: 5, units: null, ruledOut: 0 });
	});

	test('the checked line counts only fully read units as read, and every dropped candidate as ruled out', () => {
		const funnel: ReviewFunnel = {
			...FUNNEL,
			dropped: { ...FUNNEL.dropped, evidence: 2, refuted: 3 },
			brief: {
				complete: false,
				units: [
					{ id: 'a', status: 'included' },
					{ id: 'b', status: 'partial' },
					{ id: 'c', status: 'omitted', reason: 'file-cap' }
				]
			}
		};

		const { units, ruledOut } = bugLists(review({ funnel }), {}).checked;

		expect(units).toEqual({ read: 1, total: 3 });
		expect(ruledOut).toBe(5);
	});

	test('a review that did not count its funnel leaves units and ruled out unknown', () => {
		const { units, ruledOut } = bugLists(review({ funnel: undefined }), {}).checked;

		expect([units, ruledOut]).toEqual([null, null]);
	});

	test('a decided finding leaves the open list for the decided one, and a quieted topic hides it from both', () => {
		const [first, second, ...rest] = SAMPLE_REVIEW.findings;
		const decided: Finding = { ...first, decision: { state: 'accepted', decidedAt: '2026-10-13T10:00:00.000Z' } };
		const quieted: Finding = { ...second, topic: { id: 't1', label: 'Naming', quieted: true } };
		const lists = bugLists(review({ findings: [decided, quieted, ...rest] }), {});

		expect(ids(lists.open)).toEqual(ids(rest.filter((finding) => finding.tier !== 'fyi')));
		expect(lists.decided.map((bug) => bug.id)).toEqual([first.id]);
		expect(lists.quieted.map((bug) => bug.id)).toEqual([second.id]);
	});

	test('the duration runs from the review’s start to its last update', () => {
		expect(
			bugLists(review({ startedAt: '2026-10-13T09:00:00.000Z', updatedAt: '2026-10-13T09:06:40.000Z' }), {}).duration
		).toBe('6m 40s');
	});
});
