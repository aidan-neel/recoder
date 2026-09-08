import { describe, expect, test } from 'bun:test';
import { expandFileDiff, parseUnifiedDiff } from './diff';

const SINGLE = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
 tail`;

describe('parseUnifiedDiff', () => {
	test('parses hunks with counts and line numbers', () => {
		const [file] = parseUnifiedDiff(SINGLE);
		expect(file.path).toBe('a.ts');
		expect(file.additions).toBe(2);
		expect(file.deletions).toBe(1);
		expect(file.hunks).toHaveLength(1);
		const types = file.hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo]);
		expect(types).toEqual([
			['context', 1, 1],
			['del', 2, null],
			['add', null, 2],
			['add', null, 3],
			['context', 3, 4]
		]);
	});

	test('parses multiple files', () => {
		const files = parseUnifiedDiff(`${SINGLE}\n${SINGLE.replaceAll('a.ts', 'b.ts')}`);
		expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
	});

	test('returns empty for empty input', () => {
		expect(parseUnifiedDiff('')).toEqual([]);
		expect(parseUnifiedDiff('nothing here\n')).toEqual([]);
	});

	test('skips no-newline markers', () => {
		const [file] = parseUnifiedDiff(
			'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new'
		);
		expect(file.hunks[0].lines).toHaveLength(2);
	});

	test('resolves paths from ---/+++ without a diff --git header', () => {
		const [file] = parseUnifiedDiff('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new');
		expect(file.path).toBe('a.ts');
		expect(file.hunks).toHaveLength(1);
	});

	test('unquotes paths with spaces', () => {
		const [file] = parseUnifiedDiff(
			'diff --git "a/my file.ts" "b/my file.ts"\n--- "a/my file.ts"\n+++ "b/my file.ts"\n@@ -1 +1 @@\n-old\n+new'
		);
		expect(file.path).toBe('my file.ts');
	});
});

describe('expandFileDiff', () => {
	test('fills unchanged lines around a mid-file hunk', () => {
		const [file] = parseUnifiedDiff(
			`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -3,3 +3,3 @@
 line3
-line4
+line4-changed
 line5`
		);
		const expanded = expandFileDiff(
			file,
			['line1', 'line2', 'line3', 'line4-changed', 'line5', 'line6'].join('\n')
		);
		expect(expanded.hunks).toHaveLength(1);
		expect(expanded.hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo, l.text])).toEqual([
			['context', 1, 1, 'line1'],
			['context', 2, 2, 'line2'],
			['context', 3, 3, 'line3'],
			['del', 4, null, 'line4'],
			['add', null, 4, 'line4-changed'],
			['context', 5, 5, 'line5'],
			['context', 6, 6, 'line6']
		]);
	});
});
