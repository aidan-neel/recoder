import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { suggestedChange, suggestionBlock } from '../../../src/forge/publish/suggestion';

/** The pull request adds lines 11 to 13 of src/a.ts. */
const PULL_DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -10,2 +10,5 @@',
	' keep',
	'+const a = 1;',
	'+const b = a + 1;',
	'+return b;',
	' tail'
].join('\n');

function patched(patch: string[], overrides: Partial<Finding> = {}): Finding {
	return {
		id: 'f',
		file: 'src/a.ts',
		line: 12,
		severity: 'warning',
		message: 'm',
		patch: {
			diff: ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', ...patch].join('\n'),
			checks: []
		},
		...overrides
	};
}

const REPLACE_TWO = ['@@ -10,5 +10,4 @@', ' keep', '-const a = 1;', '-const b = a + 1;', '+const b = 2;', ' return b;'];

test('a small single replacement covering the finding becomes a suggestion over the replaced lines', () => {
	const change = suggestedChange(patched(REPLACE_TWO), PULL_DIFF);

	expect(change).toEqual({
		target: { path: 'src/a.ts', oldPath: 'src/a.ts', side: 'new', oldLine: null, newLine: 12 },
		span: 1,
		replacement: 'const b = 2;'
	});
});

test('GitLab counts the replaced lines above the anchor and GitHub uses the comment range', () => {
	const change = suggestedChange(patched(REPLACE_TWO), PULL_DIFF)!;

	expect(suggestionBlock('gitlab', change)).toBe('```suggestion:-1+0\nconst b = 2;\n```');
	expect(suggestionBlock('github', change)).toBe('```suggestion\nconst b = 2;\n```');
});

test('replacement code holding a fence gets a longer fence, so it cannot close the block', () => {
	const change = suggestedChange(
		patched(['@@ -11,1 +11,1 @@', '-const a = 1;', '+const a = "```";'], { line: 11 }),
		PULL_DIFF
	)!;

	expect(suggestionBlock('github', change)).toBe('````suggestion\nconst a = "```";\n````');
});

test('a patch that is not the complete fix for the commented lines gives no suggestion', () => {
	const twoRuns = [
		'@@ -11,3 +11,3 @@',
		'-const a = 1;',
		'+const a = 2;',
		' const b = a + 1;',
		'-return b;',
		'+return a;'
	];

	const elsewhere = ['@@ -13,1 +13,1 @@', '-return b;', '+return 0;'];
	const otherFile = patched(REPLACE_TWO, { file: 'src/b.ts' });

	expect(suggestedChange(patched(twoRuns), PULL_DIFF)).toBeNull();
	expect(suggestedChange(patched(elsewhere, { line: 11, endLine: 11 }), PULL_DIFF)).toBeNull();
	expect(suggestedChange(otherFile, PULL_DIFF)).toBeNull();
});

test('a patch replacing lines the pull request diff does not show gives no suggestion', () => {
	const outside = ['@@ -40,1 +40,1 @@', '-old();', '+fresh();'];

	expect(suggestedChange(patched(outside, { line: 40 }), PULL_DIFF)).toBeNull();
});

test('a patch over the size cap gives no suggestion', () => {
	const removed = Array.from({ length: 11 }, (_, index) => `-line ${index}`);
	const added = Array.from({ length: 11 }, (_, index) => `+line ${index} fixed`);

	expect(suggestedChange(patched(['@@ -11,11 +11,11 @@', ...removed, ...added], { line: 11 }), PULL_DIFF)).toBeNull();
});
