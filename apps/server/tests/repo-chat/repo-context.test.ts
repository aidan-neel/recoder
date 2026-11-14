import { expect, test } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { namedFiles, repoContext } from '../../src/repo-chat/repo-context';
import { MAX_FILE_BYTES } from '../../src/review/pipeline/change-model/repo';
import type { RepoInventory } from '../../src/review/pipeline/repo-inventory/repo-inventory';
import { useCommittedRepos } from '../helpers/git';

const committedRepo = useCommittedRepos('recoder-chat-context-');

function inventory(paths: string[]): RepoInventory {
	const files = paths.map((path) => ({
		path,
		blob: 'b',
		size: 1,
		language: null,
		classification: 'source' as const,
		packageId: null
	}));

	return { revision: 'r', files, byPath: new Map(files.map((file) => [file.path, file])) };
}

test('a message names a file by its path, or by a name only one file has', () => {
	const repo = inventory(['src/cart/total.ts', 'src/cart/index.ts', 'src/user/index.ts', 'README.md']);

	expect(namedFiles(['Look at ./src/cart/total.ts and total.ts'], repo)).toEqual(['src/cart/total.ts']);
	expect(namedFiles(['Why does index.ts export twice?'], repo)).toEqual([]);
	expect(namedFiles(['cart/index.ts vs user/index.ts'], repo)).toEqual(['src/cart/index.ts', 'src/user/index.ts']);
	expect(namedFiles(['nothing here', 'README.md first'], repo)).toEqual(['README.md']);
});

test('at most three named files are read, newest message first', () => {
	const repo = inventory(['a.ts', 'b.ts', 'c.ts', 'd.ts']);

	expect(namedFiles(['d.ts', 'a.ts b.ts c.ts'], repo)).toEqual(['d.ts', 'a.ts', 'b.ts']);
});

test('a named file too large to read in full is left out instead of read', async () => {
	const root = await committedRepo({
		'src/huge.json': `"${'x'.repeat(MAX_FILE_BYTES)}"`,
		'src/small.ts': 'export const SMALL = 1;\n'
	});

	const at = new Date().toISOString();

	const repo = {
		id: crypto.randomUUID(),
		name: 'acme/shop',
		url: pathToFileURL(root).href,
		provider: 'local' as const,
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	};

	const { text: context, files } = await repoContext(
		repo,
		['Compare huge.json with small.ts'],
		AbortSignal.timeout(10_000)
	);

	expect(context).toContain('--- src/small.ts ---');
	expect(context).not.toContain('--- src/huge.json ---');
	expect(files).toEqual(['src/small.ts']);
});
