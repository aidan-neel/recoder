import { expect, test } from 'bun:test';
import { buildInventory } from '../../src/review/pipeline/inventory';
import { formatToolResults } from '../../src/evidence/format';
import { retrieve } from '../../src/evidence/retrieval';

test('patch numbers follow each side across replacements, context and separate hunks', async () => {
	const inventory = buildInventory(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -3,3 +3,4 @@
 before
-old
+new
+extra
 after
@@ -20,1 +21,0 @@
-gone`);

	const result = await retrieve(
		{ revision: null, inventory, maxFileChars: 12000 },
		{ action: 'readDiff', path: 'a.ts' }
	);

	expect(formatToolResults([result]).split('\n').slice(3)).toEqual([
		'@@ -3,3 +3,4 @@',
		' 3|before',
		'-4|old',
		'+4|new',
		'+5|extra',
		' 6|after',
		'@@ -20,1 +21,0 @@',
		'-20|gone'
	]);

	expect(result.hunkIds).toEqual(['a.ts:3,3:3,4', 'a.ts:20,1:21,0']);
	expect(result.truncated).toBe(false);
});
