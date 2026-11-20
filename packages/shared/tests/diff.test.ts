import { describe, expect, test } from 'bun:test';
import { collapseFileDiff, expandFileDiff, parseUnifiedDiff } from '../src/diff';
import { detectMoves } from '../src/diff-moves';

test('Git-quoted rename paths decode octal UTF-8 and escaped whitespace', () => {
	const files = parseUnifiedDiff(String.raw`diff --git a/old b/new
similarity index 100%
rename from "caf\303\251\told.ts"
rename to "new\tfile.ts"`);

	expect(files[0]).toMatchObject({ path: 'new\tfile.ts', oldPath: 'café\told.ts', status: 'renamed' });
});

const SINGLE = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
 tail`;

test.each(['rename', 'copy'])('metadata-only %s retains its destination, source and similarity', (operation) => {
	const files = parseUnifiedDiff(
		`diff --git a/old.ts b/new.ts\nsimilarity index 100%\n${operation} from old.ts\n${operation} to new.ts`
	);

	expect(files).toMatchObject([
		{
			path: 'new.ts',
			oldPath: 'old.ts',
			status: operation === 'rename' ? 'renamed' : 'copied',
			similarity: 100,
			hunks: []
		}
	]);

	expect(detectMoves(files)).toMatchObject([{ exact: true, fromPath: 'old.ts', toPath: 'new.ts' }]);
});

test('rename hunks keep their destination and never treat header-like code as move metadata', () => {
	const [file] = parseUnifiedDiff(
		'diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-rename from source\n+copy to target'
	);

	expect(file).toMatchObject({ path: 'new.ts', oldPath: 'old.ts', similarity: 90, additions: 1, deletions: 1 });
	expect(file.hunks[0].lines.map((line) => line.text)).toEqual(['rename from source', 'copy to target']);
});

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

	test('a removed `-- comment` or an added `++x` inside a hunk is content, so later lines keep their numbers', () => {
		const [file] = parseUnifiedDiff(
			'diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1,4 +1,4 @@\n one\n--- comment\n+++x\n four\n five'
		);

		expect(file.hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo, l.text])).toEqual([
			['context', 1, 1, 'one'],
			['del', 2, null, '-- comment'],
			['add', null, 2, '++x'],
			['context', 3, 3, 'four'],
			['context', 4, 4, 'five']
		]);
	});

	test('the empty entry after a trailing newline is not a context line', () => {
		const [file] = parseUnifiedDiff('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n');

		expect(file.hunks[0].lines.map((l) => l.type)).toEqual(['del', 'add']);
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

		const expanded = expandFileDiff(file, ['line1', 'line2', 'line3', 'line4-changed', 'line5', 'line6'].join('\n'));

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

describe('collapseFileDiff', () => {
	const full = expandFileDiff(
		parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -10,1 +10,1 @@
-old
+new
`)[0],
		Array.from({ length: 30 }, (_, i) => (i === 9 ? 'new' : `line ${i + 1}`)).join('\n')
	);

	test('keeps only changed lines with three lines of context', () => {
		const collapsed = collapseFileDiff(full);

		expect(collapsed.hunks).toHaveLength(1);
		expect(collapsed.hunks[0].lines.map((line) => line.newNo ?? line.oldNo)).toEqual([7, 8, 9, 10, 10, 11, 12, 13]);
		expect(collapsed.hunks[0]).toMatchObject({ oldStart: 7, oldCount: 7, newStart: 7, newCount: 7 });
	});

	test('keeps requested lines as their own hunk', () => {
		const collapsed = collapseFileDiff(full, [25]);

		expect(collapsed.hunks.map((hunk) => [hunk.newStart, hunk.newCount])).toEqual([
			[7, 7],
			[22, 7]
		]);
	});

	test('keeps the hunks of an unexpanded diff apart', () => {
		const diff = parseUnifiedDiff(
			[
				'diff --git a/a.ts b/a.ts',
				'--- a/a.ts',
				'+++ b/a.ts',
				'@@ -1,6 +1,7 @@',
				...[' l1', ' l2', ' l3', '+added', ' l4', ' l5', ' l6'],
				'@@ -20,6 +21,7 @@',
				...[' l20', ' l21', ' l22', '+added', ' l23', ' l24', ' l25'],
				''
			].join('\n')
		)[0];

		expect(collapseFileDiff(diff).hunks.map((hunk) => [hunk.newStart, hunk.newCount])).toEqual([
			[1, 7],
			[21, 7]
		]);
	});
});
