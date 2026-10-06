import { expect, test } from 'bun:test';
import { changedLines, chooseAnchor } from '../../../src/review/pipeline/candidate-repair-anchor';
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

test('a line range in the candidate’s prose counts as a citation, and the nearest cited line wins', () => {
	const raw = reported({ line: 46, claim: noPath, body: 'Lines 11-12 shift without a check, and q.ts:44 cleans up.' });

	expect(chooseAnchor(candidateOf(raw), inventory)).toMatchObject({ line: 44, tier: 'cited' });
});

test('a cited line that also holds a symbol the fix introduces beats a line that is only cited', () => {
	const steps = [11, 14].map((line) => ({ file: 'src/q.ts', line, note: 'a step' }));
	const fix = [{ file: 'src/q.ts', find: 'save(queue);', replace: 'persistNext(queue[0]);\nsave(queue);' }];
	const raw = reported({ line: 9, claim: { ...noPath, executionPath: steps }, fix });

	expect(chooseAnchor(candidateOf(raw), inventory)).toMatchObject({
		line: 14,
		tier: 'cited-symbol',
		terms: ['persistNext']
	});
});
