import { afterEach, describe, expect, test } from 'bun:test';
import { PULL_LIST_PAGE } from '@recoder/shared';
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

/** One GraphQL pull request node with the head commit's check counts. */
function graphqlNode(
	number: number,
	counts: { runs?: Record<string, number>; statuses?: Record<string, number> } = {}
) {
	const toCounts = (by: Record<string, number> = {}) => Object.entries(by).map(([state, count]) => ({ state, count }));

	return {
		number,
		title: 'Fix it',
		url: `https://github.com/o/r/pull/${number}`,
		body: '',
		author: { login: 'octo' },
		baseRefName: 'main',
		headRefName: 'feat',
		headRefOid: HEAD,
		additions: 3,
		deletions: 1,
		changedFiles: 2,
		createdAt: '2026-11-01T00:00:00Z',
		updatedAt: '2026-11-02T00:00:00Z',
		isDraft: false,
		assignees: { nodes: [{ login: 'dev', name: 'Dev' }] },
		commits: {
			nodes: [
				{
					commit: {
						statusCheckRollup: {
							contexts: {
								checkRunCountsByState: toCounts(counts.runs),
								statusContextCountsByState: toCounts(counts.statuses)
							}
						}
					}
				}
			]
		}
	};
}

/** A GraphQL `pullRequests` answer with `nodes` and, when `endCursor` is set, a next page after it. */
function graphqlPage(nodes: unknown[], endCursor?: string) {
	const pageInfo = { hasNextPage: endCursor !== undefined, endCursor: endCursor ?? null };

	return { out: { data: { repository: { pullRequests: { pageInfo, nodes } } } } };
}

test('the list reads each pull request status and check tally from the check counts', async () => {
	const node = graphqlNode(7, {
		runs: { SUCCESS: 1, SKIPPED: 1, IN_PROGRESS: 1, QUEUED: 1, TIMED_OUT: 1 },
		statuses: { FAILURE: 1, PENDING: 1, SUCCESS: 1 }
	});

	const gh = await fakeGh({ 'api-graphql': [graphqlPage([{ ...node, isDraft: true }])] });

	process.env.PATH = gh.path;

	const {
		entries: [entry]
	} = await githubPullForge('https://github.com/o/r').list(null);

	expect(entry.pull).toMatchObject({ number: 7, headSha: HEAD, additions: 3 });
	expect(entry.pull.assignees?.[0]).toMatchObject({ login: 'dev', name: 'Dev' });

	expect(entry.status).toEqual({
		state: 'open',
		draft: true,
		mergeability: 'unknown',
		updatedAt: '2026-11-02T00:00:00Z',
		checks: { passed: 3, failed: 2, pending: 3 },
		commits: null
	});
});

test('a pull request whose head has no checks has no tally', async () => {
	const gh = await fakeGh({
		'api-graphql': [graphqlPage([graphqlNode(7), { ...graphqlNode(8), commits: { nodes: [] } }])]
	});

	process.env.PATH = gh.path;

	const { entries } = await githubPullForge('https://github.com/o/r').list(null);

	expect(entries.map((entry) => entry.status.checks)).toEqual([null, null]);
});

/** The GraphQL calls a fake `gh` logged; a call's query spans several lines, so the log is split where a call starts. */
async function graphqlCalls(gh: { calls: () => Promise<string[]> }): Promise<string[]> {
	return (await gh.calls()).join('\n').split(/^(?=api graphql)/m);
}

test('the list asks for one page and hands back the cursor of the next', async () => {
	const nodes = Array.from({ length: PULL_LIST_PAGE }, (_, index) => graphqlNode(PULL_LIST_PAGE - index));
	const gh = await fakeGh({ 'api-graphql': [graphqlPage(nodes, 'cursor-1')] });

	process.env.PATH = gh.path;

	const list = await githubPullForge('https://github.com/o/r').list(null);
	const [call, ...rest] = await graphqlCalls(gh);

	expect(list.entries).toHaveLength(PULL_LIST_PAGE);
	expect(list.nextCursor).toBe('cursor-1');
	expect(rest).toHaveLength(0);
	expect(call).toContain(`first=${PULL_LIST_PAGE}`);
	expect(call).not.toContain('after=');
});

test('the next page is read after the cursor, and the last page has none', async () => {
	const gh = await fakeGh({ 'api-graphql': [graphqlPage([graphqlNode(3)])] });

	process.env.PATH = gh.path;

	const list = await githubPullForge('https://github.com/o/r').list('cursor-1');

	expect(list.nextCursor).toBeNull();
	expect((await graphqlCalls(gh))[0]).toContain('after=cursor-1');
});

test('an answer without a pull request list is a forge failure that names GitHub’s errors', async () => {
	const gh = await fakeGh({ 'api-graphql': [{ out: { errors: [{ message: 'Could not resolve to a Repository' }] } }] });

	process.env.PATH = gh.path;

	await expect(githubPullForge('https://github.com/o/r').list(null)).rejects.toThrow(
		'Could not resolve to a Repository'
	);
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

/** The merge methods of a repository where the person has `viewerPermission` and squash and rebase are allowed. */
async function mergeMethodsFor(viewerPermission: string) {
	const gh = await fakeGh({
		'repo-view': [
			{ out: { viewerPermission, mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true } }
		]
	});

	process.env.PATH = gh.path;

	return githubPullForge('https://github.com/o/r').mergeMethods();
}

test('the allowed merge methods come from the repository settings', async () => {
	expect(await mergeMethodsFor('WRITE')).toEqual(['squash', 'rebase']);
	expect(await mergeMethodsFor('MAINTAIN')).toEqual(['squash', 'rebase']);
	expect(await mergeMethodsFor('ADMIN')).toEqual(['squash', 'rebase']);
});

test('a person who can only read or triage a repository has no merge methods', async () => {
	expect(await mergeMethodsFor('READ')).toEqual([]);
	expect(await mergeMethodsFor('TRIAGE')).toEqual([]);
});
