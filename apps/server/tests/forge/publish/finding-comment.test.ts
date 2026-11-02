import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { inlineTarget } from '../../../src/forge/publish/finding-comment';

const DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -10,3 +10,4 @@',
	' keep',
	'-gone',
	'+added',
	'+more',
	' tail'
].join('\n');

function at(line: number, side?: 'old' | 'new'): Finding {
	return { id: 'f', file: 'src/a.ts', line, severity: 'error', message: 'm', ...(side ? { side } : {}) };
}

test('an added line has only a new line number', () => {
	expect(inlineTarget(at(11), DIFF)).toMatchObject({ side: 'new', oldLine: null, newLine: 11 });
});

test('an unchanged context line carries both sides, which GitLab requires', () => {
	expect(inlineTarget(at(13), DIFF)).toMatchObject({ side: 'new', oldLine: 12, newLine: 13 });
});

test('a deleted line is found on the old side', () => {
	expect(inlineTarget(at(11, 'old'), DIFF)).toMatchObject({ side: 'old', oldLine: 11, newLine: null });
});

test('a line outside the diff has no inline target, so the finding posts as a plain comment', () => {
	expect(inlineTarget(at(40), DIFF)).toBeNull();
	expect(inlineTarget({ ...at(11), file: 'src/other.ts' }, DIFF)).toBeNull();
});
