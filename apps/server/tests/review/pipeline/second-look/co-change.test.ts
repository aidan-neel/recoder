import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { coChanges, companions } from '../../../../src/review/pipeline/second-look/co-change';
import { git } from '../../../helpers/git';

test('a file that changed with the anchor in most commits is a companion, and a sweeping commit counts for nothing', () => {
	const sweep = ['src/a.ts', 'src/index.ts', ...Array.from({ length: 40 }, (_, index) => `src/gen/${index}.ts`)];

	const commits = [
		['src/a.ts', 'src/index.ts', 'CHANGELOG.md'],
		['src/a.ts', 'src/index.ts'],
		['src/a.ts', 'src/index.ts', 'CHANGELOG.md'],
		['src/a.ts', 'README.md'],
		sweep,
		sweep,
		sweep
	];

	expect(companions(commits, 'src/a.ts', new Set())).toEqual([
		{ file: 'src/index.ts', with: 'src/a.ts', together: 3, of: 4 }
	]);

	expect(companions(commits, 'src/a.ts', new Set(['src/index.ts']))).toEqual([]);
});

/** A repo whose history adds three middleware, each with an export in `src/index.ts`, then returns the base sha. */
async function middlewareRepo(root: string): Promise<string> {
	const run = (args: string[]) => git(root, args);

	const write = async (path: string, content: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	};

	run(['init', '-q', '-b', 'main']);
	run(['config', 'user.name', 'Test']);
	run(['config', 'user.email', 'test@example.com']);

	let exports = '';

	for (const name of ['cors', 'etag', 'timing']) {
		exports += `export * from './middleware/${name}/index';\n`;
		await write(`src/middleware/${name}/index.ts`, `export const ${name} = 1;\n`);
		await write('src/index.ts', exports);
		run(['add', '.']);
		run(['commit', '-q', '-m', `add ${name}`]);
	}

	return run(['rev-parse', 'HEAD']);
}

test('an added file in a new folder takes its companions from the nearest folder above it that has history', async () => {
	const root = mkdtempSync(join(tmpdir(), 'co-change-'));
	const baseSha = await middlewareRepo(root);

	const hints = await coChanges({
		checkoutPath: root,
		baseSha,
		files: [{ path: 'src/middleware/limit/index.ts', added: true }],
		changed: new Set(['src/middleware/limit/index.ts']),
		signal: new AbortController().signal
	});

	expect(hints).toEqual([{ file: 'src/index.ts', with: 'src/middleware/', together: 3, of: 3 }]);
});
