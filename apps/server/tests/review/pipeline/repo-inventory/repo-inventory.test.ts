import { expect, test } from 'bun:test';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRepoInventory } from '../../../../src/review/pipeline/repo-inventory/repo-inventory';
import { commitAll, git, useCommittedRepos } from '../../../helpers/git';

const signal = new AbortController().signal;
const committedRepo = useCommittedRepos('repo-inventory-');

test('lists the regular files at the commit with their blob ids, not the symlink or uncommitted work', async () => {
	const root = await committedRepo({ 'b.ts': 'export const b = 1;\n', 'a file.md': '# a\n' });

	await symlink('b.ts', join(root, 'link.ts'));
	commitAll(root, 'link');

	const sha = git(root, ['rev-parse', 'HEAD']);

	await writeFile(join(root, 'b.ts'), 'export const b = 2;\n');
	await writeFile(join(root, 'untracked.ts'), 'export {};\n');

	const repo = await loadRepoInventory(root, sha, signal, []);

	expect(repo.files.map((file) => file.path)).toEqual(['a file.md', 'b.ts']);
	expect(repo.byPath.get('b.ts')?.blob).toBe(git(root, ['rev-parse', `${sha}:b.ts`]));
	expect(repo.byPath.get('b.ts')?.size).toBe('export const b = 1;\n'.length);
});

test('a revision git cannot list is an error, not an empty repository', async () => {
	const root = await committedRepo({ 'b.ts': 'export const b = 1;\n' });

	await expect(loadRepoInventory(root, 'f'.repeat(40), signal, [])).rejects.toThrow('git ls-tree');
});
