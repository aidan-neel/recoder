import { expect, test } from 'bun:test';
import { parseUnifiedDiff } from '@recoder/shared';
import { descriptionPrompt } from '../../../src/review/description/prompt';

test('the input budget trims the largest hunks first without dropping any file or its stats', () => {
	const largeLine = 'x'.repeat(400);

	const files = parseUnifiedDiff(
		`diff --git a/large.ts b/large.ts
@@ -0,0 +1,2 @@
+first change
+${largeLine}
diff --git a/small.ts b/small.ts
@@ -1 +1 @@
-old value
+new value
`
	);

	const pull = { title: 'Title', body: 'Author body' };
	const full = descriptionPrompt(pull, files);
	const budget = full.reduce((length, message) => length + message.content.length, 0) - 200;
	const trimmed = descriptionPrompt(pull, files, budget);
	const input = trimmed[1].content;

	expect(trimmed.reduce((length, message) => length + message.content.length, 0)).toBeLessThanOrEqual(budget);
	expect(input).toContain('"large.ts" (+2 -0)');
	expect(input).toContain('"small.ts" (+1 -1)');
	expect(input).toContain('+first change');
	expect(input).toContain('+new value');
	expect(input).not.toContain(largeLine);
});
