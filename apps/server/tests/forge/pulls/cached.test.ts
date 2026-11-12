import { afterEach, expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';
import { pullDiff } from '../../../src/forge/pulls/cached';
import { PullHeadMoved } from '../../../src/forge/pulls/status';
import { fakeGh } from '../../helpers/fake-gh';

const realPath = process.env.PATH;

afterEach(() => {
	process.env.PATH = realPath;
});

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

/** The diff GitHub sends once head B was pushed. */
const DIFF_B = 'diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-old\n+new\n';

/** A GitHub repository with an id of its own, so no other test's cached diff answers. */
function githubRepo(): Repo {
	return {
		id: crypto.randomUUID(),
		name: 'o/r',
		url: 'https://github.com/o/r',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

/** `gh pr view` for pull request 7 at `head`. */
function viewAt(head: string) {
	return { out: { number: 7, title: 'Fix it', headRefOid: head, createdAt: '2026-11-01T00:00:00Z', state: 'OPEN' } };
}

test('a push between the head read and the diff fetch never labels the newer files with the older head', async () => {
	const gh = await fakeGh({ 'pr-view': [viewAt(HEAD_A), viewAt(HEAD_B)], 'pr-diff': [{ text: DIFF_B }] });

	process.env.PATH = gh.path;

	const diff = await pullDiff(githubRepo(), 7, HEAD_A);

	expect(diff.headSha).toBe(HEAD_B);
	expect(diff.files.map((file) => file.path)).toEqual(['b.ts']);
});

test('a diff whose head kept moving on every fetch answers as a moved head', async () => {
	const heads = ['1', '2', '3', '4', '5', '6', '7'].map((digit) => viewAt(digit.repeat(40)));
	const gh = await fakeGh({ 'pr-view': heads, 'pr-diff': [{ text: DIFF_B }] });

	process.env.PATH = gh.path;

	await expect(pullDiff(githubRepo(), 7, HEAD_A)).rejects.toBeInstanceOf(PullHeadMoved);
});
