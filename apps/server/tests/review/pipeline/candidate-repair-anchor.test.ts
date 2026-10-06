import { expect, test } from 'bun:test';
import { changedLines, chooseAnchor } from '../../../src/review/pipeline/candidate-repair-anchor';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { candidateOf, repairContext, reported } from './candidate-repair-fixtures';

const { inventory } = repairContext();
const noPath = { ...reported().claim, executionPath: [] };

test('only added lines that hold code can carry an anchor: never a comment, context or removed line', () => {
	expect(changedLines(inventory, 'src/q.ts').map((line) => line.line)).toEqual([11, 12, 14, 44]);
	expect(changedLines(inventory, 'src/other.ts')).toEqual([]);
});

test('the line the candidate’s fix edits wins over a line it only cites', () => {
	const fix = [{ file: 'src/q.ts', find: 'if (!next) return;', replace: 'if (!next) {\n\tsave(queue);\n\treturn;\n}' }];

	expect(chooseAnchor(candidateOf(reported({ fix })), inventory)).toMatchObject({ line: 12, tier: 'patch-target' });
});

test('a quoted symbol the change introduces places the candidate; one the file already had does not', () => {
	const introduced = reported({ claim: noPath, body: 'Calling `persistNext(next)` before `save(queue)` loses order.' });
	const existing = reported({ claim: noPath, body: 'The `save(queue)` call runs too late.' });

	expect(chooseAnchor(candidateOf(introduced), inventory)).toEqual({
		line: 14,
		tier: 'quoted-symbol',
		terms: ['persistNext'],
		text: 'persistNext(next);'
	});

	expect(chooseAnchor(candidateOf(existing), inventory)).toEqual({
		miss: 'none',
		reason: 'no changed line in src/q.ts holds code the candidate cites'
	});
});

test('a fix whose find text also sits on a context or removed line, or on two added lines, places nothing', () => {
	const fixes = ['save(queue);', 'queue.pop();'].map((find) => [{ file: 'src/q.ts', find, replace: 'drop();' }]);

	for (const fix of fixes) {
		expect(chooseAnchor(candidateOf(reported({ claim: noPath, fix })), inventory)).toMatchObject({ miss: 'none' });
	}

	const twice = buildInventory(
		`diff --git a/src/r.ts b/src/r.ts
--- a/src/r.ts
+++ b/src/r.ts
@@ -1,1 +1,3 @@
 start();
+if (value === undefined) return null;
+if (value === undefined) return null;
`,
		[]
	);

	const fix = [{ file: 'src/r.ts', find: 'if (value === undefined) return null;', replace: 'throw new Missing();' }];
	const raw = reported({ file: 'src/r.ts', claim: noPath, fix });

	expect(chooseAnchor(candidateOf(raw, 'correctness', { ...repairContext(), inventory: twice }), twice)).toMatchObject({
		miss: 'none'
	});
});

test('prose cites a line only as path:N or path:N-M, never as bare "lines N"', () => {
	const cites = (body: string) => chooseAnchor(candidateOf(reported({ line: 46, claim: noPath, body })), inventory);

	expect(cites('Lines 11 to 12 shift without a check, and lines 12 and 44 clean up.')).toMatchObject({ miss: 'none' });
	expect(cites('See other/q.ts:44 for the cleanup.')).toMatchObject({ miss: 'none' });

	expect(cites('src/q.ts:11-12 shift without a check, and q.ts:44 cleans up.')).toMatchObject({
		line: 44,
		tier: 'cited'
	});

	expect(cites('src/q.ts:11-12 shift without a check.')).toMatchObject({ line: 12, tier: 'cited' });
});

test('a cited line that also holds a symbol the candidate quotes beats a line that is only cited', () => {
	const steps = [11, 14].map((line) => ({ file: 'src/q.ts', line, note: 'a step' }));

	const raw = reported({
		line: 9,
		claim: { ...noPath, executionPath: steps },
		body: 'Calls `persistNext(next)` early.'
	});

	expect(chooseAnchor(candidateOf(raw), inventory)).toMatchObject({
		line: 14,
		tier: 'cited-symbol',
		terms: ['persistNext']
	});
});

test('a symbol the candidate’s fix holds ties no line to the claim, even when quoted', () => {
	const steps = [11, 14].map((line) => ({ file: 'src/q.ts', line, note: 'a step' }));
	const fix = [{ file: 'src/q.ts', find: 'save(queue);', replace: 'persistNext(queue[0]);\nsave(queue);' }];
	const body = 'Calls `persistNext(next)` early.';
	const raw = reported({ line: 9, claim: { ...noPath, executionPath: steps }, fix, body });

	expect(chooseAnchor(candidateOf(raw), inventory)).toMatchObject({ line: 11, tier: 'cited', terms: [] });
	expect(chooseAnchor(candidateOf(reported({ claim: noPath, fix, body })), inventory)).toMatchObject({ miss: 'none' });
});
