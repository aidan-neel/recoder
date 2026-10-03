import { expect, test } from 'bun:test';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { planSubagents, type UnitRequest } from '../../../src/review/pipeline/subagents';
import { partitionUnits } from '../../../src/review/pipeline/units';
import { TWO_UNIT_DIFF } from './harness-fixtures';

const inventory = buildInventory(TWO_UNIT_DIFF, []);
const units = partitionUnits(inventory);

/** A request from `unitId` about `concern` over the whole of `path`. */
function ask(unitId: string, concern: string, path: string): UnitRequest {
	return {
		unitId,
		unitTitle: unitId,
		request: { concern, question: `Is ${concern} safe?`, scope: [{ path, hunkIds: [] }], why: 'w' }
	};
}

test('requests run in unit order up to the cap, and the rest are dropped', () => {
	const plan = planSubagents(
		[
			ask('unit-2', 'Test isolation', 'tests/b.ts'),
			ask('unit-2', 'Fixture reuse', 'tests/b.ts'),
			ask('unit-1', 'Callers of parse', 'src/a.ts'),
			ask('unit-1', 'Error paths', 'src/a.ts')
		],
		units,
		inventory,
		2
	);

	expect(plan.units.map((unit) => [unit.id, unit.title])).toEqual([
		['subagent-1', 'Callers of parse'],
		['subagent-2', 'Error paths']
	]);

	expect(plan.dropped.map((entry) => entry.request.concern)).toEqual(['Test isolation', 'Fixture reuse']);
});

test('a request with the same concern over overlapping hunks as an earlier one is merged, not counted', () => {
	const plan = planSubagents(
		[
			ask('unit-1', 'Callers of parse', 'src/a.ts'),
			ask('unit-2', '  callers of  PARSE ', 'src/a.ts'),
			ask('unit-2', 'Callers of parse', 'tests/b.ts')
		],
		units,
		inventory,
		4
	);

	expect(plan.units.map((unit) => [unit.title, unit.scope.map((entry) => entry.path)])).toEqual([
		['Callers of parse', ['src/a.ts']],
		['Callers of parse', ['tests/b.ts']]
	]);

	expect(plan.dropped).toEqual([]);
});

test('a scope outside the review falls back to the requesting unit, and a file named without hunks means all of them', () => {
	const plan = planSubagents(
		[ask('unit-2', 'Ghost file', 'nowhere.ts'), ask('unit-1', 'Whole file', 'src/a.ts')],
		units,
		inventory,
		4
	);

	const whole = inventory.files.find((file) => file.path === 'src/a.ts')!.hunks.map((hunk) => hunk.id);

	expect(plan.units.find((unit) => unit.title === 'Ghost file')!.scope).toEqual(units[1].scope);
	expect(plan.units.find((unit) => unit.title === 'Whole file')!.scope).toEqual([{ path: 'src/a.ts', hunkIds: whole }]);
});

test('with subagents off nothing runs and nothing is reported dropped', () => {
	expect(planSubagents([ask('unit-1', 'Callers of parse', 'src/a.ts')], units, inventory, 0)).toEqual({
		units: [],
		dropped: []
	});
});
