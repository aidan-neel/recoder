import { expect, test } from 'bun:test';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { unitClaims, unitInput } from '../../../../src/review/pipeline/intent/brief';
import { partitionUnits } from '../../../../src/review/pipeline/units';
import { addedFile } from '../harness-fixtures';

/**
 * The first unit's brief input for `diff`, and how many units the partition
 * cut. A one-line file in a later folder ends the diff, so the parser's
 * blank line after the last hunk is not counted in the file under test.
 */
function inputOf(diff: string) {
	const run = createRun({ diff: diff + addedFile('z/end.ts', 1), sandboxPath: null });
	const units = partitionUnits(run.inventory);

	return { units: units.length, ...unitInput(run.inventory, null, units[0].scope) };
}

/** A modified file with one hunk of added lines per entry of `sizes`, each a thousand lines after the last. */
function hunks(path: string, sizes: number[]): string {
	const body = sizes.map((lines, index) => {
		const start = index * 1000 + 1;
		const changed = Array.from({ length: lines }, (_, line) => `+${`${index}-${line}`.padEnd(99, 'y')}`);

		return `@@ -${start},0 +${start},${lines} @@\n${changed.join('\n')}`;
	});

	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body.join('\n')}\n`;
}

test('a unit the partition sized to fit is shown whole, though its line numbers make the text longer', () => {
	const input = inputOf(addedFile('a/x.ts', 117) + addedFile('a/y.ts', 117));

	expect(input.units).toBe(1);
	expect(input.text.length).toBeGreaterThan(24_000);
	expect(input.clipped).toEqual([]);
	expect(input.text).not.toContain('not shown');
});

test('a file larger than a whole unit is cut at a line, with the lines shown and left out counted', () => {
	const input = inputOf(addedFile('a/big.ts', 300));

	expect(input.clipped).toEqual([{ path: 'a/big.ts', shown: 237, total: 300 }]);
	expect(input.text).toContain('…63 more lines of this hunk not shown');
});

test('a hunk too large for the share is named by its header, and the hunks after it are still shown', () => {
	const input = inputOf(hunks('src/m.ts', [3, 250, 4]));

	expect(input.clipped).toEqual([{ path: 'src/m.ts', shown: 7, total: 257 }]);
	expect(input.text).toContain('@@ -1001,0 +1001,250 @@\n…250 more lines of this hunk not shown');
	expect(input.text).toContain('+2003| 2-2');
});

test('a claim on a deleted file must cite an old line the diff shows, and is pinned to the merge base', () => {
	const gone =
		'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n-b\n-c\n';

	const run = createRun({ diff: gone + addedFile('src/z.ts', 3), sandboxPath: null });
	const [unit] = partitionUnits(run.inventory);
	const source = { inventory: run.inventory, model: null, unit, revision: 'HEAD', base: 'BASE' };

	const raw = [
		{ text: 'Removes the third line', file: 'src/gone.ts', line: 3 },
		{ text: 'Invented line', file: 'src/gone.ts', line: 42 },
		{ text: 'Adds z', file: 'src/z.ts', line: 1 }
	];

	expect(unitInput(run.inventory, null, unit.scope).text).toContain('-3| c');

	expect(unitClaims(raw, source)).toEqual([
		{
			text: 'Removes the third line',
			file: 'src/gone.ts',
			line: 3,
			unit: 'unit-1',
			range: { start: 1, end: 3 },
			revision: 'BASE'
		},
		{ text: 'Adds z', file: 'src/z.ts', line: 1, unit: 'unit-1', range: { start: 1, end: 3 }, revision: 'HEAD' }
	]);

	expect(unitClaims(raw.slice(0, 1), { ...source, base: undefined })).toEqual([
		{ text: 'Removes the third line', file: 'src/gone.ts', line: 3, unit: 'unit-1' }
	]);
});
