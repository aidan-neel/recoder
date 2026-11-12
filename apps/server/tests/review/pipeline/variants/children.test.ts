import { expect, test } from 'bun:test';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import type { UnitRequest } from '../../../../src/review/pipeline/subagents';
import type { ReviewUnit } from '../../../../src/review/pipeline/units';
import { planRequestedSubagents } from '../../../../src/review/pipeline/variants/children';
import { DIFF, HUNK } from '../harness-fixtures';

const INVENTORY = buildInventory(DIFF, []);

const SCOPE = [{ path: 'src/a.ts', hunkIds: [HUNK] }];

/** `count` requests from `unitId`, each a distinct concern so none merges with another. */
function requests(unitId: string, count: number): UnitRequest[] {
	return Array.from({ length: count }, (_, index) => ({
		unitId,
		unitTitle: unitId,
		request: { concern: `Concern ${index + 1}`, question: 'Does it hold?', scope: SCOPE, why: 'Wide.' }
	}));
}

function unit(id: string): ReviewUnit {
	return { id, title: id, reason: '', scope: SCOPE };
}

test("a specialist's fourth request is dropped however much room the cap leaves", () => {
	const plan = planRequestedSubagents(requests('specialist-security', 4), [unit('specialist-security')], INVENTORY, 10);

	expect(plan.units).toHaveLength(3);
	expect(plan.dropped.map((entry) => entry.request.concern)).toEqual(['Concern 4']);
});

test("a baseline reviewer's requests are all planned up to the cap", () => {
	const plan = planRequestedSubagents(requests('reviewer-1', 4), [unit('reviewer-1')], INVENTORY, 10);

	expect(plan.units).toHaveLength(4);
	expect(plan.dropped).toEqual([]);
});

test('a specialist split in two by its retry sends no more than its own three children', () => {
	const halves = ['retry-specialist-security-a', 'retry-specialist-security-b'];

	const plan = planRequestedSubagents(
		[...requests(halves[0], 3), ...requests(halves[1], 3)].map((entry, index) => ({
			...entry,
			request: { ...entry.request, concern: `Concern ${index + 1}` }
		})),
		['specialist-security', ...halves].map(unit),
		INVENTORY,
		12
	);

	expect(plan.units).toHaveLength(3);
	expect(plan.dropped).toHaveLength(3);
});
