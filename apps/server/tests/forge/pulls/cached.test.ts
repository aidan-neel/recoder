import { afterEach, expect, test } from 'bun:test';
import type { PullRequest, Repo } from '@recoder/shared';
import { forgetPull, pullCommits, pullConversation, pullDiff, pullHead } from '../../../src/forge/pulls/cached';
import { PullHeadMoved } from '../../../src/forge/pulls/status';
import { fakeGh } from '../../helpers/fake-gh';
import { restoreFetch, stubForge } from '../../helpers/forge-fetch';

const realPath = process.env.PATH;

afterEach(() => {
	process.env.PATH = realPath;
	restoreFetch();
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

/** A pull request at `head` of the test repository, enough for the cached reads. */
function pullAt(head: string): PullRequest {
	return {
		number: 7,
		title: 'Fix it',
		url: 'https://github.com/o/r/pull/7',
		author: 'al',
		base: 'main',
		headRef: 'fix',
		headSha: head,
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		createdAt: '2026-11-01T00:00:00Z'
	};
}

test('the head read asks only for the head, not the pull request’s whole status', async () => {
	const gh = await fakeGh({ 'pr-view': [{ out: { headRefOid: HEAD_A } }] });

	process.env.PATH = gh.path;

	expect(await pullHead(githubRepo(), 7)).toBe(HEAD_A);
	expect(await gh.calls()).toEqual(['pr view 7 --repo o/r --json headRefOid']);
});

test('commits under one head are read once, and again under another head', async () => {
	const calls = stubForge(() => [200, []]);
	const repo = githubRepo();
	const pull = pullAt(HEAD_A);

	await Promise.all([pullCommits(repo, pull), pullCommits(repo, pull)]);
	await pullCommits(repo, pull);

	const commits = () => calls.filter((call) => call.url.includes('/pulls/7/commits')).length;

	expect(commits()).toBe(1);

	await pullCommits(repo, pullAt(HEAD_B));
	expect(commits()).toBe(2);
});

test('the conversation is read once across concurrent callers', async () => {
	const calls = stubForge(() => [200, []]);
	const repo = githubRepo();
	const pull = pullAt(HEAD_A);

	await pullConversation(repo, pull);

	const once = calls.length;

	await Promise.all([pullConversation(repo, pull), pullConversation(repo, pull)]);
	expect(calls).toHaveLength(once);
});

test('forgetting a pull request drops its commits and conversation too', async () => {
	const calls = stubForge(() => [200, []]);
	const repo = githubRepo();
	const pull = pullAt(HEAD_A);

	await pullCommits(repo, pull);
	await pullConversation(repo, pull);

	forgetPull(repo, 7);

	await pullCommits(repo, pull);
	await pullConversation(repo, pull);

	expect(calls.filter((call) => call.url.includes('/pulls/7/commits'))).toHaveLength(2);
});
