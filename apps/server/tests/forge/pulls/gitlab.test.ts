import { afterEach, describe, expect, test } from 'bun:test';
import { PULL_LIST_PAGE, type Repo } from '@recoder/shared';
import { MERGE_STATS_PARALLEL } from '../../../src/forge/gitlab-api';
import { gitlabMergeability, gitlabMergeMethods, gitlabPullForge } from '../../../src/forge/pulls/gitlab';
import { clearToken, setToken } from '../../../src/forge/tokens';
import { restoreFetch, stubForge } from '../../helpers/forge-fetch';

afterEach(() => {
	restoreFetch();
	clearToken('gitlab');
});

const REPO: Repo = {
	id: 'gitlab-paging',
	name: 'a/b',
	url: 'https://gitlab.com/a/b',
	provider: 'gitlab',
	defaultBranch: 'main',
	createdAt: '',
	updatedAt: ''
};

/** GitLab with `count` open merge requests, newest first, paged the way its API pages them. */
function openMergeRequests(count: number) {
	const all = Array.from({ length: count }, (_, index) => ({
		iid: count - index,
		title: `MR ${count - index}`,
		sha: 'c'.repeat(40),
		state: 'opened',
		created_at: '2026-11-01T00:00:00Z'
	}));

	return stubForge(({ url }) => {
		const query = new URL(url).searchParams;

		if (!url.includes('/merge_requests?')) return [200, []];

		const perPage = Number(query.get('per_page'));
		const page = Number(query.get('page') ?? '1');

		return [200, all.slice((page - 1) * perPage, page * perPage)];
	});
}

test('the list reads one page and names the page number that follows it', async () => {
	setToken('gitlab', 'test-token');
	openMergeRequests(150);

	const first = await gitlabPullForge(REPO).list(null);
	const second = await gitlabPullForge(REPO).list(first.nextCursor);

	expect(first.entries).toHaveLength(PULL_LIST_PAGE);
	expect(first.entries[0].pull.number).toBe(150);
	expect(first.nextCursor).toBe('2');
	expect(second.entries[0].pull.number).toBe(150 - PULL_LIST_PAGE);
});

/**
 * GitLab with `count` open merge requests whose diff requests stay open for one turn of the event loop, and the
 * most of them that were open at once.
 */
function slowDiffs(count: number): { most: () => number } {
	const rows = Array.from({ length: count }, (_, index) => ({
		iid: index + 1,
		sha: 'c'.repeat(40),
		state: 'opened',
		created_at: '2026-11-01T00:00:00Z'
	}));

	let open = 0;
	let most = 0;

	globalThis.fetch = (async (url: string) => {
		if (!String(url).includes('/diffs')) return Response.json(String(url).includes('/merge_requests?') ? rows : []);

		open += 1;
		most = Math.max(most, open);
		await new Promise((resolve) => setImmediate(resolve));
		open -= 1;

		return Response.json([]);
	}) as typeof fetch;

	return { most: () => most };
}

test('the list reads the line counts of a few merge requests at a time, never all at once', async () => {
	setToken('gitlab', 'test-token');

	const diffs = slowDiffs(PULL_LIST_PAGE);
	const list = await gitlabPullForge(REPO).list(null);

	expect(list.entries).toHaveLength(PULL_LIST_PAGE);
	expect(diffs.most()).toBe(MERGE_STATS_PARALLEL);
});

test('a repository with fewer open merge requests than a page has no next page', async () => {
	setToken('gitlab', 'test-token');
	openMergeRequests(PULL_LIST_PAGE - 1);

	const list = await gitlabPullForge(REPO).list(null);

	expect(list).toMatchObject({ nextCursor: null, entries: { length: PULL_LIST_PAGE - 1 } });
});

describe('gitlabMergeability', () => {
	test('a conflict reads as conflicts in either status field', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'conflict' })).toBe('conflicts');
		expect(gitlabMergeability({ detailed_merge_status: 'mergeable', has_conflicts: true })).toBe('conflicts');
		expect(gitlabMergeability({ merge_status: 'cannot_be_merged' })).toBe('conflicts');
	});

	test('a pipeline, an approval or a rule that stops the merge blocks it', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'ci_must_pass' })).toBe('blocked');
		expect(gitlabMergeability({ detailed_merge_status: 'not_approved' })).toBe('blocked');
		expect(gitlabMergeability({ detailed_merge_status: 'discussions_not_resolved' })).toBe('blocked');
	});

	test('a status GitLab is still working out is unknown', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'checking' })).toBe('unknown');
		expect(gitlabMergeability({ merge_status: 'unchecked' })).toBe('unknown');
		expect(gitlabMergeability({})).toBe('unknown');
	});

	test('a mergeable request is clean on new and old GitLab', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'mergeable' })).toBe('clean');
		expect(gitlabMergeability({ merge_status: 'can_be_merged' })).toBe('clean');
	});
});

/** A project's permissions as GitLab reports them, with the person's access level in the project and its group. */
function access(project: number | null, group: number | null = null) {
	return {
		permissions: {
			project_access: project === null ? null : { access_level: project },
			group_access: group === null ? null : { access_level: group }
		}
	};
}

describe('gitlabMergeMethods', () => {
	test('a merge-commit project allows a merge and an optional squash', () => {
		expect(gitlabMergeMethods({ ...access(40), merge_method: 'merge', squash_option: 'default_off' })).toEqual([
			'merge',
			'squash'
		]);
	});

	test('a fast-forward project merges like a rebase', () => {
		expect(gitlabMergeMethods({ ...access(40), merge_method: 'ff', squash_option: 'never' })).toEqual(['rebase']);
	});

	test('a project that always squashes allows only a squash', () => {
		expect(gitlabMergeMethods({ ...access(40), merge_method: 'rebase_merge', squash_option: 'always' })).toEqual([
			'squash'
		]);
	});

	test('a group role counts when the person has no role in the project itself', () => {
		expect(gitlabMergeMethods({ ...access(null, 50), merge_method: 'merge' })).toEqual(['merge', 'squash']);
	});

	test('a Developer, a Reporter and a person with no access cannot merge', () => {
		expect(gitlabMergeMethods({ ...access(30), merge_method: 'merge' })).toEqual([]);
		expect(gitlabMergeMethods({ ...access(20, 10), merge_method: 'merge' })).toEqual([]);
		expect(gitlabMergeMethods({ merge_method: 'merge' })).toEqual([]);
	});
});
