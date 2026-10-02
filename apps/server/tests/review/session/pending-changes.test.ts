import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	commitPendingChanges,
	discardPendingChanges,
	listPendingChanges,
	pushPendingCommits,
	safePaths,
	undoLastCommit
} from '../../../src/review/session/pending-changes';

let base = '';
let repo = '';
let remote = '';

const git = (cwd: string, ...args: string[]) => {
	const run = Bun.spawnSync(['git', ...args], {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t'
		}
	});

	if (run.exitCode !== 0) throw new Error(run.stderr.toString());

	return run.stdout.toString().trim();
};

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'recoder-changes-'));
	remote = join(base, 'remote.git');
	repo = join(base, 'repo');
	git(base, 'init', '-q', '--bare', '-b', 'feature', remote);
	git(base, 'init', '-q', '-b', 'feature', repo);
	await writeFile(join(repo, 'a.ts'), 'a\n');
	await writeFile(join(repo, 'b.ts'), 'b\n');
	git(repo, 'add', '.');
	git(repo, 'commit', '-q', '-m', 'init');
	git(repo, 'remote', 'add', 'origin', remote);
	git(repo, 'push', '-q', 'origin', 'feature');
});

afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});

test('commits only the chosen files, with the message as written', async () => {
	await writeFile(join(repo, 'a.ts'), 'a2\n');
	await writeFile(join(repo, 'b.ts'), 'b2\n');
	await writeFile(join(repo, 'new.ts'), 'n\n');

	expect((await listPendingChanges(repo)).files.map((file) => [file.path, file.status])).toEqual([
		['a.ts', 'modified'],
		['b.ts', 'modified'],
		['new.ts', 'added']
	]);

	await commitPendingChanges(repo, ['a.ts', 'new.ts'], 'Fix the thing\n\nBecause reasons.');

	const pending = await listPendingChanges(repo);

	expect(pending.files.map((file) => file.path)).toEqual(['b.ts']);
	expect(pending.commits.map((commit) => commit.subject)).toEqual(['Fix the thing']);
	expect(git(repo, 'log', '-1', '--format=%B')).toBe('Fix the thing\n\nBecause reasons.');
});

test('nothing reaches the remote until push, and push clears the unpushed list', async () => {
	await writeFile(join(repo, 'a.ts'), 'a2\n');
	await commitPendingChanges(repo, ['a.ts'], 'Change a');
	expect(git(remote, 'log', '-1', '--format=%s', 'feature')).toBe('init');

	await pushPendingCommits(repo, 'feature');
	expect(git(remote, 'log', '-1', '--format=%s', 'feature')).toBe('Change a');
	expect((await listPendingChanges(repo)).commits).toEqual([]);
});

test('undoing an unpushed commit puts its changes back in the working tree', async () => {
	await writeFile(join(repo, 'a.ts'), 'a2\n');
	await commitPendingChanges(repo, ['a.ts'], 'Change a');
	await undoLastCommit(repo);

	const pending = await listPendingChanges(repo);

	expect(pending.commits).toEqual([]);
	expect(pending.files.map((file) => file.path)).toEqual(['a.ts']);
	await expect(undoLastCommit(repo)).rejects.toThrow('already pushed');
});

test('discarding restores tracked files and deletes new ones', async () => {
	await writeFile(join(repo, 'a.ts'), 'a2\n');
	await writeFile(join(repo, 'new.ts'), 'n\n');
	await discardPendingChanges(repo, ['a.ts', 'new.ts']);
	expect(await readFile(join(repo, 'a.ts'), 'utf8')).toBe('a\n');
	expect(existsSync(join(repo, 'new.ts'))).toBe(false);
	expect((await listPendingChanges(repo)).files).toEqual([]);
});

test('paths outside the checkout are refused', () => {
	expect(() => safePaths(['../secret'])).toThrow();
	expect(() => safePaths(['/etc/passwd'])).toThrow();
	expect(() => safePaths(['.git/config'])).toThrow();
});

test('a checkout still being cloned lists no changes and refuses writes', async () => {
	const cloning = join(base, 'cloning');

	git(base, 'init', '-q', cloning);
	await writeFile(join(cloning, 'a.ts'), 'a\n');
	expect(await listPendingChanges(cloning)).toEqual({ files: [], commits: [] });
	await expect(commitPendingChanges(cloning, ['a.ts'], 'x')).rejects.toThrow('still being prepared');
});
