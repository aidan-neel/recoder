import { afterAll, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { parseUnifiedDiff } from '@recoder/shared';
import type { ReviewTarget } from '../../../src/cli/review/options';
import { resolveTarget } from '../../../src/cli/target/resolve-target';
import { git } from '../../helpers/git';
import { removeFixtureFolders, repositoryState, targetRequest, userRepository, writeFiles } from './fixture';

afterAll(removeFixtureFolders);

/** A repository with a staged edit to `a.ts`, an unstaged edit to `b.ts`, a new file and an ignored one. */
async function busyRepository(objectFormat: 'sha1' | 'sha256' = 'sha1'): Promise<string> {
	const dir = await userRepository({ 'a.ts': 'one\n', 'b.ts': 'bee\n' }, objectFormat);

	await writeFiles(dir, { 'a.ts': 'one\nstaged\n' });
	git(dir, ['add', 'a.ts']);
	await writeFiles(dir, { 'b.ts': 'bee\nunstaged\n', 'new.ts': 'untracked\n', 'debug.log': 'ignored\n' });

	return dir;
}

test('a staged review holds what is staged and leaves unstaged edits out', async () => {
	const dir = await busyRepository();

	const resolved = await resolveTarget(targetRequest(dir, { kind: 'staged' }));

	expect(resolved.diff).toContain('+staged');
	expect(resolved.diff).not.toContain('unstaged');
	expect(resolved.diff).not.toContain('new.ts');
	expect(resolved.report.base).toBe('HEAD');
	expect(resolved.revision?.mergeBaseSha).toBe(git(dir, ['rev-parse', 'HEAD']));

	await resolved.dispose();
});

test('an uncommitted review includes untracked files and skips ignored ones', async () => {
	const dir = await busyRepository();

	const resolved = await resolveTarget(targetRequest(dir, { kind: 'uncommitted' }));
	const checkout = resolved.sandboxPath ?? '';

	expect(resolved.diff).toContain('+staged');
	expect(resolved.diff).toContain('+unstaged');
	expect(resolved.diff).toContain('b/new.ts');
	expect(resolved.diff).not.toContain('debug.log');
	expect(await readFile(join(checkout, 'new.ts'), 'utf8')).toBe('untracked\n');
	expect(existsSync(join(checkout, 'debug.log'))).toBe(false);

	await resolved.dispose();
});

test('staged and uncommitted reviews leave the repository exactly as it was', async () => {
	const dir = await busyRepository();
	const before = repositoryState(dir);

	for (const kind of ['staged', 'uncommitted'] as const) {
		const resolved = await resolveTarget(targetRequest(dir, { kind }));

		await resolved.dispose();
	}

	expect(repositoryState(dir)).toBe(before);
});

test('a review started from a git hook ignores the variables git exports to hooks', async () => {
	const dir = await busyRepository();
	const before = repositoryState(dir);
	const hookEnv = { GIT_DIR: join(dir, '.git'), GIT_WORK_TREE: dir, GIT_INDEX_FILE: join(dir, '.git', 'index') };

	Object.assign(process.env, hookEnv);

	try {
		const resolved = await resolveTarget(targetRequest(dir, { kind: 'uncommitted' }));

		await resolved.dispose();
	} finally {
		for (const key of Object.keys(hookEnv)) delete process.env[key];
	}

	expect(repositoryState(dir)).toBe(before);
});

/** A time well in the past, so any refresh of a file's time shows. */
const LONG_AGO = new Date('2001-01-01T00:00:00Z');

test('in a sparse checkout, staged and uncommitted reviews match git diff --cached and git diff HEAD', async () => {
	const dir = await sparseRepository();
	const before = repositoryState(dir);
	const staged = await changedPaths(dir, { kind: 'staged' });
	const uncommitted = await changedPaths(dir, { kind: 'uncommitted' });

	expect(staged).toEqual(diffNames(dir, ['--cached']));
	expect(uncommitted).toEqual([...diffNames(dir, ['HEAD']), 'out/new.txt'].sort());
	expect(uncommitted).not.toContain('out/d.txt');
	expect(repositoryState(dir)).toBe(before);
});

test.each(['sha1', 'sha256'] as const)(
	'a %s repository with a split index is snapshot and left as it was',
	async (objectFormat) => {
		const dir = await busyRepository(objectFormat);

		git(dir, ['config', 'core.splitIndex', 'true']);
		git(dir, ['update-index', '--split-index']);

		const sharedIndex = join(
			dir,
			'.git',
			readdirSync(join(dir, '.git')).find((name) => name.startsWith('sharedindex.')) ?? ''
		);

		const before = repositoryState(dir);

		await utimes(sharedIndex, LONG_AGO, LONG_AGO);

		for (const kind of ['staged', 'uncommitted'] as const) {
			const resolved = await resolveTarget(targetRequest(dir, { kind }));

			expect(resolved.diff).toContain('+staged');
			await resolved.dispose();
		}

		expect(statSync(sharedIndex).mtime).toEqual(LONG_AGO);
		expect(repositoryState(dir)).toBe(before);
	}
);

/**
 * A sparse checkout of `in/` with a change in the cone, an index-only change
 * outside it, a changed file on disk outside it, an untouched one and an
 * untracked one.
 */
async function sparseRepository(): Promise<string> {
	const dir = await userRepository({ 'in/a.txt': 'a\n', 'out/b.txt': 'b\n', 'out/c.txt': 'c\n', 'out/d.txt': 'd\n' });

	git(dir, ['sparse-checkout', 'set', 'in']);
	await writeFiles(dir, { 'in/a.txt': 'a2\n' });

	const blob = git(dir, ['hash-object', '-w', 'in/a.txt']);

	git(dir, ['update-index', '--cacheinfo', `100644,${blob},out/b.txt`]);
	git(dir, ['update-index', '--skip-worktree', 'out/b.txt']);
	await writeFiles(dir, { 'out/c.txt': 'c2\n', 'out/new.txt': 'new\n' });

	return dir;
}

/** The sorted paths a review of `target` in `dir` changes. */
async function changedPaths(dir: string, target: ReviewTarget): Promise<string[]> {
	const resolved = await resolveTarget(targetRequest(dir, target));
	const paths = parseUnifiedDiff(resolved.diff).map((file) => file.path);

	await resolved.dispose();

	return paths.sort();
}

/** The sorted paths `git diff` names in `dir`, read without refreshing the index. */
function diffNames(dir: string, args: string[]): string[] {
	return git(dir, ['--no-optional-locks', 'diff', '--name-only', ...args])
		.split('\n')
		.filter(Boolean)
		.sort();
}
