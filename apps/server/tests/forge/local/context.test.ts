import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Repo } from '@recoder/shared';
import { gatherChangeContext, prsForCommit } from '../../../src/forge/pr-context';
import { fetchPull, fetchPullPreview } from '../../../src/forge/pull-preview';
import { repoFileHost } from '../../../src/forge/repo-files';
import { fakeBin } from '../../helpers/fake-bin';
import { git } from '../../helpers/git';
import { localForgeFixture } from '../../helpers/local-forge';

const signal = new AbortController().signal;
const realFetch = globalThis.fetch;
const realPath = process.env.PATH;

afterEach(() => {
	globalThis.fetch = realFetch;
	process.env.PATH = realPath;
});

const numbers = async (repo: Repo, sha: string) =>
	(await prsForCommit(repo, 'local', sha, signal)).map((ref) => ref.number);

/** Commits `file` on a new branch and merges it into main with `message`, returning the branch commit and the merge. */
async function mergeBranch(dir: string, file: string, ...message: string[]) {
	git(dir, ['checkout', '-q', '-b', file]);
	await writeFile(join(dir, file), `${file}\n`);
	git(dir, ['add', file]);
	git(dir, ['commit', '-q', '-m', `Write ${file}`]);

	const branch = git(dir, ['rev-parse', 'HEAD']);

	git(dir, ['checkout', '-q', 'main']);
	git(dir, ['merge', '-q', '--no-ff', file, ...message.flatMap((paragraph) => ['-m', paragraph])]);

	return { branch, merge: git(dir, ['rev-parse', 'HEAD']) };
}

test('a local pull gathers its body, closing issue with comments, discussion, thread and commits', async () => {
	const { repo, pull7Commit } = await localForgeFixture();
	const context = await gatherChangeContext(repo, 7, 'local', signal);
	const byRef = Object.fromEntries(context.sources.map((source) => [source.ref, source]));

	expect(byRef.pr.text).toBe('Makes two loud. Closes #5.');
	expect(byRef['issue:#5']).toMatchObject({ title: 'Two is too quiet', text: 'Nobody notices two.' });
	expect(byRef['comment:#5/1'].text).toBe('I will make it loud.');
	expect(byRef['comment:pr/1'].text).toBe('Looks fine overall.');
	expect(byRef['thread:#7/1']).toMatchObject({ title: 'a.ts:2', text: 'al: Why upper case?' });
	expect(byRef[`commit:${pull7Commit.slice(0, 7)}`]).toMatchObject({ title: 'Change a', text: 'See #5' });
	expect(context.people).toContain('Labels: bug');
});

test('a commit maps to the pull whose baseSha..head holds it, and a squash names its pull in the subject', async () => {
	const { repo, root, pull3Commit, squash, pull7Commit } = await localForgeFixture();

	expect(await numbers(repo, pull7Commit)).toEqual([7]);
	expect(await numbers(repo, pull3Commit)).toEqual([3]);
	expect(await numbers(repo, squash)).toEqual([3]);
	expect(await numbers(repo, root)).toEqual([]);
});

test('a merge commit names its saved pull when the pull has no mergeSha, and a number with no saved pull maps to none', async () => {
	const { repo, root } = await localForgeFixture();
	const dir = fileURLToPath(repo.url);
	const file = join(git(dir, ['rev-parse', '--absolute-git-dir']), 'recoder-forge.json');
	const forge = JSON.parse(await readFile(file, 'utf8'));

	forge.pulls.push({ ...forge.pulls[0], number: 9, title: 'Write b', headRef: 'b.ts', baseSha: root });
	await writeFile(file, JSON.stringify(forge));

	const saved = await mergeBranch(dir, 'b.ts', 'Merge pull request #9 from al/b', 'Write b');
	const unsaved = await mergeBranch(dir, 'c.ts', 'Merge pull request #11 from al/c', 'Write c');

	expect(await numbers(repo, saved.merge)).toEqual([9]);
	expect(await numbers(repo, saved.branch)).toEqual([]);
	expect(await numbers(repo, unsaved.merge)).toEqual([]);
	expect(await numbers(repo, unsaved.branch)).toEqual([]);
});

test('a local repo never reaches fetch, gh or glab', async () => {
	const { repo } = await localForgeFixture();
	const marker = join(await mkdtemp(join(tmpdir(), 'recoder-forge-cli-')), 'called');
	const script = `#!/bin/sh\necho "$0 $*" >> ${marker}\nexit 1\n`;
	const fetched: string[] = [];

	process.env.PATH = (await fakeBin('gh', script)).env.PATH;
	process.env.PATH = `${(await fakeBin('glab', script)).env.PATH.split(':')[0]}:${process.env.PATH}`;

	globalThis.fetch = (async (input: RequestInfo | URL) => {
		fetched.push(String(input));

		throw new Error('network is off');
	}) as unknown as typeof fetch;

	const host = repoFileHost(repo);

	await fetchPullPreview(repo, 7);
	await fetchPull(repo, 7);
	await prsForCommit(repo, 'local', 'HEAD', signal);
	await host.readFile('a.ts', (await host.defaultBranch()).branch);

	expect((await gatherChangeContext(repo, 7, 'local', signal)).sources.length).toBeGreaterThan(0);
	expect(fetched).toEqual([]);
	expect(existsSync(marker)).toBe(false);
});
