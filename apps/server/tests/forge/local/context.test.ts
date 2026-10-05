import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherChangeContext, prsForCommit } from '../../../src/forge/pr-context';
import { fetchPull, fetchPullPreview } from '../../../src/forge/pull-preview';
import { repoFileHost } from '../../../src/forge/repo-files';
import { fakeBin } from '../../helpers/fake-bin';
import { localForgeFixture } from '../../helpers/local-forge';

const signal = new AbortController().signal;
const realFetch = globalThis.fetch;
const realPath = process.env.PATH;

afterEach(() => {
	globalThis.fetch = realFetch;
	process.env.PATH = realPath;
});

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
	const numbers = async (sha: string) => (await prsForCommit(repo, 'local', sha, signal)).map((ref) => ref.number);

	expect(await numbers(pull7Commit)).toEqual([7]);
	expect(await numbers(pull3Commit)).toEqual([3]);
	expect(await numbers(squash)).toEqual([3]);
	expect(await numbers(root)).toEqual([]);
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
