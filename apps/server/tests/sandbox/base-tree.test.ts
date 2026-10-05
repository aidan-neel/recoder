import { afterEach, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseTree } from '../../src/sandbox/base-tree';
import { execUnavailableReason, sandboxLayout } from '../../src/sandbox/exec-sandbox';
import { ExecWorkspace } from '../../src/sandbox/exec-workspace';
import { git } from '../helpers/git';

const available = (await execUnavailableReason()) === null;
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** A repo whose base commit holds `src/a.ts` = old and whose head commit holds new, with installed dependencies in the head checkout. */
async function twoCommits(headFiles: Record<string, string> = {}) {
	const root = await mkdtemp(join(import.meta.dir, '.base-tree-test-'));

	roots.push(root);

	const checkout = join(root, 'work/repos/pr-1');

	const write = async (path: string, content: string) => {
		await mkdir(join(checkout, path, '..'), { recursive: true });
		await writeFile(join(checkout, path), content);
	};

	await mkdir(checkout, { recursive: true });
	git(checkout, ['init', '-q', '-b', 'main']);
	await write('src/a.ts', 'old\n');
	await write('package.json', '{"name":"x"}\n');
	git(checkout, ['add', '.']);
	git(checkout, ['commit', '-q', '-m', 'base']);

	const baseSha = git(checkout, ['rev-parse', 'HEAD']);

	await write('src/a.ts', 'new\n');
	for (const [path, content] of Object.entries(headFiles)) await write(path, content);
	git(checkout, ['add', '.']);
	git(checkout, ['commit', '-q', '-m', 'head']);
	await write('node_modules/dep/index.js', 'module.exports = 1;\n');

	const layout = sandboxLayout(checkout, {
		home: join(root, 'home'),
		dataDir: join(root, 'data'),
		workDir: join(root, 'work')
	});

	return { checkout, layout, baseSha, headSha: git(checkout, ['rev-parse', 'HEAD']) };
}

test('a base tree holds the merge-base files and links the installed dependencies', async () => {
	const { checkout, layout, baseSha, headSha } = await twoCommits();
	const tree = new BaseTree(layout, headSha, baseSha);

	expect(await tree.prepare()).toBeNull();
	expect(await readFile(join(tree.root, 'src/a.ts'), 'utf8')).toBe('old\n');
	expect(await readFile(join(checkout, 'src/a.ts'), 'utf8')).toBe('new\n');
	expect((await lstat(join(tree.root, 'node_modules'))).isSymbolicLink()).toBe(true);
	expect(await readlink(join(tree.root, 'node_modules'))).toBe(join(layout.checkout, 'node_modules'));
});

test('a base tree is unavailable when a dependency manifest changed in the change', async () => {
	const { layout, baseSha, headSha } = await twoCommits({ 'package.json': '{"name":"x","dependencies":{"y":"1"}}\n' });
	const tree = new BaseTree(layout, headSha, baseSha);

	expect(await tree.prepare()).toContain('manifests changed');
});

test('a base tree is still built when package.json changed without touching its dependencies', async () => {
	const { layout, baseSha, headSha } = await twoCommits({
		'package.json': '{"name":"x","exports":{"./a":"./src/a.ts"}}\n'
	});

	const tree = new BaseTree(layout, headSha, baseSha);

	expect(await tree.prepare()).toBeNull();
});

test('a base tree gets back the files a command changed and leaves the head checkout alone', async () => {
	const { checkout, layout, baseSha, headSha } = await twoCommits();
	const tree = new BaseTree(layout, headSha, baseSha);

	await tree.prepare();
	await writeFile(join(tree.root, 'src/a.ts'), 'edited\n');
	await tree.restore();

	expect(await readFile(join(tree.root, 'src/a.ts'), 'utf8')).toBe('old\n');
	expect(git(checkout, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
	expect(git(checkout, ['worktree', 'list']).split('\n')).toHaveLength(1);
});

test('a base tree swapped for a link is never written through and stops being used', async () => {
	const { layout, baseSha, headSha } = await twoCommits();
	const tree = new BaseTree(layout, headSha, baseSha);
	const outside = join(layout.cacheDir, '..', 'outside');

	await tree.prepare();
	await mkdir(outside, { recursive: true });
	await rm(tree.root, { recursive: true, force: true });
	await symlink(outside, tree.root);
	await tree.restore();

	expect(await readdir(outside)).toEqual([]);
	expect(await tree.prepare()).toContain('replaced');
});

test.skipIf(!available)(
	'a command runs on the merge-base tree with the owner scratch files and the head untouched',
	async () => {
		const { checkout, layout, baseSha, headSha } = await twoCommits();
		const ws = new ExecWorkspace(checkout, headSha, layout);

		await ws.writeFile('scratch.txt', 'mine\n', undefined, 'v');

		const ran = await ws.runOnBase(
			'cat src/a.ts scratch.txt && cat node_modules/dep/index.js && echo edited > src/a.ts',
			baseSha,
			20_000,
			undefined,
			'v'
		);

		expect('output' in ran).toBe(true);
		expect(JSON.stringify(ran)).toContain('old\\nmine\\nmodule.exports = 1;');
		expect((ran as { exitCode: number }).exitCode).toBe(0);

		const again = await ws.runOnBase('cat src/a.ts', baseSha, 20_000, undefined, 'v');

		expect(again).toMatchObject({ output: expect.stringContaining('old') });
		expect(await readFile(join(checkout, 'src/a.ts'), 'utf8')).toBe('new\n');

		await ws.cleanup();
		await expect(lstat(join(layout.cacheDir, `base-${baseSha.slice(0, 12)}`))).rejects.toThrow();
	}
);

test.skipIf(!available)('a command on the merge-base tree reports why it could not run', async () => {
	const { checkout, layout, baseSha, headSha } = await twoCommits({
		'package.json': '{"name":"x","dependencies":{"y":"1"}}\n'
	});

	const ws = new ExecWorkspace(checkout, headSha, layout);

	expect(await ws.runOnBase('true', baseSha, 20_000)).toEqual({ unavailable: expect.stringContaining('manifests') });
});
