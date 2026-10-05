import { expect, test } from 'bun:test';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { LENSES, lensAssignments } from '../../../../src/review/pipeline/lenses/lenses';
import { partitionUnits } from '../../../../src/review/pipeline/units';
import { addedFile } from '../harness-fixtures';

const unitsOf = (diff: string) => partitionUnits(buildInventory(diff, []), 2_000);

test('a docs-only unit runs only the rules and readability lenses, and a unit with code runs all of them', () => {
	const units = unitsOf(addedFile('docs/guide.md', 15) + addedFile('src/a.ts', 15));
	const assignments = lensAssignments(units);
	const docs = units.find((unit) => unit.scope.every((entry) => entry.path.endsWith('.md')))!;
	const code = units.find((unit) => unit !== docs)!;

	expect(assignments.filter((item) => item.scope === docs.scope).map((item) => item.lens)).toEqual([
		'rules',
		'readability'
	]);

	expect(assignments.filter((item) => item.scope === code.scope).map((item) => item.lens)).toEqual(
		LENSES.map((lens) => lens.id)
	);
});

test('every unit fans out into one assignment per lens, with ids that keep the unit id', () => {
	const units = unitsOf(addedFile('src/a.ts', 15) + addedFile('lib/b.ts', 15));
	const assignments = lensAssignments(units);

	expect(units).toHaveLength(2);
	expect(assignments).toHaveLength(2 * LENSES.length);

	expect(assignments.map((item) => item.id)).toEqual(
		units.flatMap((unit) => LENSES.map((lens) => `${unit.id}/${lens.id}`))
	);
});
