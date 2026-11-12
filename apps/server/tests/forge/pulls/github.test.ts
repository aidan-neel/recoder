import { afterEach, describe, expect, test } from 'bun:test';
import { PULL_LIST_REPO_MAX } from '@recoder/shared';
import { githubMergeability, githubPullForge } from '../../../src/forge/pulls/github';
import { PullHeadMoved } from '../../../src/forge/pulls/status';
import { fakeGh } from '../../helpers/fake-gh';

const realPath = process.env.PATH;

afterEach(() => {
	process.env.PATH = realPath;
});

const HEAD = 'a'.repeat(40);

/** One `gh pr list` / `gh pr view` row with the status fields the forge asks for. */
function pullRow(overrides: Record<string, unknown> = {}) {
	return {
		number: 7,
		title: 'Fix it',
		url: 'https://github.com/o/r/pull/7',
		author: { login: 'octo' },
		baseRefName: 'main',
		headRefName: 'feat',
		headRefOid: HEAD,
		additions: 3,
		deletions: 1,
		changedFiles: 2,
		createdAt: '2026-11-01T00:00:00Z',
		updatedAt: '2026-11-02T00:00:00Z',
		state: 'OPEN',
		isDraft: false,
		mergeable: 'MERGEABLE',
		mergeStateStatus: 'CLEAN',
		statusCheckRollup: [],
		...overrides
	};
}

describe('githubMergeability', () => {
	test('a conflict wins over every other state', () => {
		expect(githubMergeability('CONFLICTING', 'BLOCKED')).toBe('conflicts');
		expect(githubMergeability('UNKNOWN', 'DIRTY')).toBe('conflicts');
	});

	test('branch rules, a stale base and a draft block the merge', () => {
		expect(githubMergeability('MERGEABLE', 'BLOCKED')).toBe('blocked');
		expect(githubMergeability('MERGEABLE', 'BEHIND')).toBe('blocked');
		expect(githubMergeability('MERGEABLE', 'DRAFT')).toBe('blocked');
	});

	test('a failing optional check still merges cleanly', () => {
		expect(githubMergeability('MERGEABLE', 'CLEAN')).toBe('clean');
		expect(githubMergeability('MERGEABLE', 'UNSTABLE')).toBe('clean');
		expect(githubMergeability('MERGEABLE', 'HAS_HOOKS')).toBe('clean');
	});

	test('a state GitHub has not computed yet is unknown', () => {
		expect(githubMergeability('UNKNOWN', 'UNKNOWN')).toBe('unknown');
		expect(githubMergeability(undefined, undefined)).toBe('unknown');
	});
});

test('the list reads each pull request status and check tally from one gh call', async () => {
	const rollup = [
		{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
		{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
		{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
		{ __typename: 'StatusContext', state: 'FAILURE' },
		{ __typename: 'StatusContext', state: 'PENDING' }
	];

	const gh = await fakeGh({
		'pr-list': [{ out: [pullRow({ isDraft: true, mergeStateStatus: 'BLOCKED', statusCheckRollup: rollup })] }]
	});

	process.env.PATH = gh.path;

	const {
		entries: [entry]
	} = await githubPullForge('https://github.com/o/r').list();

	expect(entry.pull).toMatchObject({ number: 7, headSha: HEAD, additions: 3 });

	expect(entry.status).toEqual({
		state: 'open',
		draft: true,
		mergeability: 'blocked',
		updatedAt: '2026-11-02T00:00:00Z',
		checks: { passed: 2, failed: 1, pending: 2 },
		commits: null
	});

	expect(await gh.calls()).toHaveLength(1);
});

/** The list of a repository with `count` open pull requests, numbered newest first, and the `gh` calls it made. */
async function listOf(count: number) {
	const rows = Array.from({ length: count }, (_, index) => pullRow({ number: count - index }));
	const gh = await fakeGh({ 'pr-list': [{ out: rows }] });

	process.env.PATH = gh.path;

	return { list: await githubPullForge('https://github.com/o/r').list(), calls: await gh.calls() };
}

test('a repository with more open pull requests than the list keeps answers the newest and says it was cut', async () => {
	const { list, calls } = await listOf(PULL_LIST_REPO_MAX + 1);

	expect(list.truncated).toBe(true);
	expect(list.entries).toHaveLength(PULL_LIST_REPO_MAX);
	expect(list.entries[0].pull.number).toBe(PULL_LIST_REPO_MAX + 1);
	expect(calls[0]).toContain(`--limit ${PULL_LIST_REPO_MAX + 1}`);
});

test('a repository with exactly as many open pull requests as the list keeps is not cut', async () => {
	const { list } = await listOf(PULL_LIST_REPO_MAX);

	expect(list).toMatchObject({ truncated: false, entries: { length: PULL_LIST_REPO_MAX } });
});

test('a pull request without checks has no tally', async () => {
	const gh = await fakeGh({ 'pr-view': [{ out: pullRow({ state: 'MERGED', commits: [{}, {}] }) }] });

	process.env.PATH = gh.path;

	const { status } = await githubPullForge('https://github.com/o/r').view(7);

	expect(status).toMatchObject({ state: 'merged', checks: null, commits: 2 });
});

test('a merge pins the head commit and never deletes the branch or bypasses protection', async () => {
	const gh = await fakeGh({
		'pr-merge': [{ out: {} }],
		'pr-view': [{ out: { ...pullRow({ state: 'MERGED' }), mergeCommit: { oid: 'm'.repeat(40) } } }]
	});

	process.env.PATH = gh.path;

	const result = await githubPullForge('https://github.com/o/r').merge(7, { method: 'squash', headSha: HEAD });
	const merge = (await gh.calls()).find((call) => call.startsWith('pr merge')) ?? '';

	expect(result).toEqual({ merged: true, sha: 'm'.repeat(40) });
	expect(merge).toContain(`--squash --match-head-commit ${HEAD}`);
	expect(merge).not.toContain('--admin');
	expect(merge).not.toContain('--delete-branch');
});

/** A merge `gh pr merge` fails with `output` on stderr. */
async function mergeFailing(output: string) {
	const gh = await fakeGh({ 'pr-merge': [{ err: output }] });

	process.env.PATH = gh.path;

	return githubPullForge('https://github.com/o/r').merge(7, { method: 'merge', headSha: HEAD });
}

test('a merge the branch rules refuse answers merged false with GitHub’s reason', async () => {
	const result = await mergeFailing(
		'X Pull request o/r#7 is not mergeable: the base branch policy prohibits the merge.'
	);

	expect(result.merged).toBe(false);
	expect(result.sha).toBeNull();
	expect(result.message).toContain('the base branch policy prohibits the merge');
});

test('a merge GitHub refuses because the head moved after the check is a moved head, not a refusal', async () => {
	const merge = mergeFailing('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)');

	await expect(merge).rejects.toBeInstanceOf(PullHeadMoved);
});

test('a refused merge’s reason never quotes a credential from the forge output', async () => {
	const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
	const result = await mergeFailing(`fatal: could not push to https://octo:${token}@github.com/o/r`);

	expect(result.merged).toBe(false);
	expect(result.message).not.toContain(token);
});

test('the allowed merge methods come from the repository settings', async () => {
	const gh = await fakeGh({
		'repo-view': [{ out: { mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true } }]
	});

	process.env.PATH = gh.path;

	expect(await githubPullForge('https://github.com/o/r').mergeMethods()).toEqual(['squash', 'rebase']);
});
