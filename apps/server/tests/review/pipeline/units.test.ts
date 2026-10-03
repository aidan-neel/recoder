import { expect, test } from 'bun:test';
import { applyDirective } from '../../../src/review/chat/directive';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { partitionUnits } from '../../../src/review/pipeline/units';
import { addedFile } from './harness-fixtures';

/** Two hunks in one file, far enough apart to stay separate. */
function twoHunks(path: string, lines: number): string {
	const block = (start: number) =>
		Array.from({ length: lines }, (_, index) => `+${String(start + index).padEnd(99, 'y')}`).join('\n');

	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${lines} @@\n${block(0)}\n@@ -500,0 +${501 + lines},${lines} @@\n${block(1000)}\n`;
}

/** Changed lines per file, apart from `lib/big.ts` (two hunks of 100). */
const LINES: Record<string, number> = { 'src/a.ts': 60, 'src/b.ts': 60, 'docs/readme.md': 10, 'src/nested/c.ts': 30 };

const SECTIONS = [...Object.entries(LINES).map(([path, lines]) => addedFile(path, lines)), twoHunks('lib/big.ts', 100)];

const units = (diff: string, budget: number) => partitionUnits(buildInventory(diff, []), budget);

test('the same change gives the same units in the same order, whatever order the diff lists its files', () => {
	const forward = units(SECTIONS.join(''), 10_000);
	const reversed = units([...SECTIONS].reverse().join(''), 10_000);

	expect(reversed).toEqual(forward);
	expect(forward.map((unit) => unit.id)).toEqual(forward.map((_, index) => `unit-${index + 1}`));
});

test('units stay under the budget and never split a file, and a file over the budget is a unit of its own', () => {
	const inventory = buildInventory(SECTIONS.join(''), []);
	const result = partitionUnits(inventory, 10_000);
	const paths = result.flatMap((unit) => unit.scope.map((entry) => entry.path));

	expect([...paths].sort()).toEqual(inventory.files.map((file) => file.path).sort());
	expect(new Set(paths).size).toBe(paths.length);

	for (const unit of result) {
		for (const entry of unit.scope) {
			expect(entry.hunkIds).toEqual(inventory.files.find((file) => file.path === entry.path)!.hunks.map((h) => h.id));
		}
	}

	const big = result.find((unit) => unit.scope.some((entry) => entry.path === 'lib/big.ts'))!;

	expect(big.scope.map((entry) => entry.path)).toEqual(['lib/big.ts']);

	for (const unit of result.filter((entry) => entry !== big)) {
		expect(unit.scope.reduce((sum, entry) => sum + LINES[entry.path] * 102, 0)).toBeLessThanOrEqual(10_000);
	}

	expect(result.length).toBeGreaterThan(2);
});

test('a small change is one unit', () => {
	const result = units(addedFile('src/a.ts', 5) + addedFile('test/a.test.ts', 5), 24_000);

	expect(result).toHaveLength(1);
	expect(result[0].scope.map((entry) => entry.path)).toEqual(['src/a.ts', 'test/a.test.ts']);
});

test('files the developer excluded, lockfiles and generated files are left out of every unit', () => {
	const inventory = buildInventory(
		SECTIONS.join('') + addedFile('bun.lock', 5) + addedFile('dist/out.js', 5) + addedFile('package-lock.json', 5),
		[]
	);

	applyDirective(inventory, { instructions: 'skip docs', includeGlobs: [], excludeGlobs: ['docs/**'] });

	const paths = partitionUnits(inventory).flatMap((unit) => unit.scope.map((entry) => entry.path));

	expect(paths).not.toContain('docs/readme.md');
	expect(paths).not.toContain('bun.lock');
	expect(paths).not.toContain('package-lock.json');
	expect(paths).toContain('src/a.ts');
});
