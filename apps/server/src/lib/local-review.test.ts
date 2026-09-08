import { expect, test } from 'bun:test';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnifiedDiff } from '@recoder/shared';
import { readSandboxFile, reviewBatches } from './harness';

test('large reviews batch every file instead of dropping files beyond the limit', () => {
	const diff = Array.from({ length: 301 }, (_, i) =>
		'diff --git a/file-' + i + '.ts b/file-' + i + '.ts\n--- a/file-' + i + '.ts\n+++ b/file-' + i + '.ts\n@@ -1 +1 @@\n-old\n+new'
	).join('\n');
	const batches = reviewBatches(diff, 40, 100_000);
	expect(batches.length).toBe(8);
	const files = batches.flatMap(parseUnifiedDiff);
	expect(new Set(files.map((file) => file.path)).size).toBe(301);
	expect(files.at(-1)?.path).toBe('file-300.ts');
});

test('reviewers cannot read symlinks outside their checkout', async () => {
	const root = await mkdtemp(join(tmpdir(), 'recoder-read-'));
	const outside = await mkdtemp(join(tmpdir(), 'recoder-outside-'));
	await writeFile(join(outside, 'secret'), 'outside');
	await symlink(join(outside, 'secret'), join(root, 'link'));
	expect(await readSandboxFile(root, 'link', 100)).toBeNull();
	await writeFile(join(root, 'source.ts'), 'inside');
	expect(await readSandboxFile(root, 'source.ts', 100)).toBe('inside');
});
