import { describe, expect, test } from 'bun:test';
import { parseUnifiedDiff } from './diff';

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
});
