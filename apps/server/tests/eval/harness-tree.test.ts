import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureTree, pathsSince } from '../../src/eval/harness-tree';
import { git } from '../helpers/git';

let repo = '';

beforeAll(async () => {
	repo = await mkdtemp(join(import.meta.dir, '.harness-tree-'));
	git(repo, ['init', '-q', '-b', 'main']);
	await mkdir(join(repo, 'src'));
	await writeFile(join(repo, 'src/a.ts'), 'a\n');
	await writeFile(join(repo, 'src/b.ts'), 'b\n');
	git(repo, ['add', '-A']);
	git(repo, ['commit', '-q', '-m', 'base']);
});

afterAll(async () => {
	await rm(repo, { recursive: true, force: true });
});

test('a report written from a dirty tree records the files that differed, so only a later edit to them counts', async () => {
	await writeFile(join(repo, 'src/a.ts'), 'edited\n');
	await writeFile(join(repo, 'src/new.ts'), 'new\n');

	const before = captureTree(repo)!;

	expect(Object.keys(before.files).sort()).toEqual(['src/a.ts', 'src/new.ts']);
	expect(pathsSince(repo, before, captureTree(repo)!)).toEqual([]);

	await writeFile(join(repo, 'src/a.ts'), 'edited again\n');
	await writeFile(join(repo, 'src/b.ts'), 'b changed\n');

	expect(pathsSince(repo, before, captureTree(repo)!)).toEqual(['src/a.ts', 'src/b.ts']);

	await rm(join(repo, 'src/new.ts'));

	expect(pathsSince(repo, before, captureTree(repo)!)).toEqual(['src/a.ts', 'src/b.ts', 'src/new.ts']);
});

test('a later commit counts every path between the commits, plus the files that were dirty', async () => {
	const before = captureTree(repo)!;

	git(repo, ['add', '-A']);
	git(repo, ['commit', '-q', '-m', 'next']);

	expect(pathsSince(repo, before, captureTree(repo)!)).toEqual(['src/a.ts', 'src/b.ts']);
});

test('outside a git checkout there is no tree', async () => {
	const outside = await mkdtemp(join(tmpdir(), 'no-git-'));

	try {
		expect(captureTree(outside)).toBeNull();
	} finally {
		await rm(outside, { recursive: true, force: true });
	}
});
