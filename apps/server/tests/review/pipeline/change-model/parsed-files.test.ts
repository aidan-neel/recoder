import { expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { parseRepoFiles } from '../../../../src/review/pipeline/change-model/parsed-files';
import { loadRepoInventory } from '../../../../src/review/pipeline/repo-inventory/repo-inventory';
import { useCommittedRepos } from '../../../helpers/git';

const signal = new AbortController().signal;
const repoWith = useCommittedRepos('parsed-files-');

test('a file parsed in one review is read back in a later one even when its checkout is gone', async () => {
	const root = await repoWith({ 'util.ts': 'export function pad(text: string) {\n\treturn ` ${text}`;\n}\n' });
	const repo = await loadRepoInventory(root, 'HEAD', signal, []);

	const names = async () =>
		(await parseRepoFiles(root, repo, ['util.ts'], signal)).get('util.ts')?.map((symbol) => symbol.name);

	expect(await names()).toEqual(['pad']);

	await rm(root, { recursive: true, force: true });

	expect(await names()).toEqual(['pad']);
});

test('the same content under another path is parsed for that path, never read back from the first', async () => {
	const text = 'export function pad(text: string) {\n\treturn text;\n}\n';
	const root = await repoWith({ 'one.ts': text, 'two.ts': text });
	const repo = await loadRepoInventory(root, 'HEAD', signal, []);

	const parsed = await parseRepoFiles(root, repo, ['one.ts', 'two.ts', 'missing.ts'], signal);

	expect(parsed.get('one.ts')?.map((symbol) => symbol.file)).toEqual(['one.ts']);
	expect(parsed.get('two.ts')?.map((symbol) => symbol.file)).toEqual(['two.ts']);
	expect(parsed.get('missing.ts')).toEqual([]);
});
