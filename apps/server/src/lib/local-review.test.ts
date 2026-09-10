import { expect, test } from 'bun:test';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSandboxFile } from './harness';

test('reviewers cannot read symlinks, including those pointing outside their checkout', async () => {
	const root = await mkdtemp(join(tmpdir(), 'recoder-read-'));
	const outside = await mkdtemp(join(tmpdir(), 'recoder-outside-'));
	await writeFile(join(outside, 'secret'), 'outside');
	await symlink(join(outside, 'secret'), join(root, 'link'));
	expect(await readSandboxFile(root, 'link', 100)).toBeNull();
	await writeFile(join(root, 'source.ts'), 'inside');
	expect(await readSandboxFile(root, 'source.ts', 100)).toBe('inside');
});
