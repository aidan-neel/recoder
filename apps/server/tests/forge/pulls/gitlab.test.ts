import { afterEach, describe, expect, test } from 'bun:test';
import { PULL_LIST_REPO_MAX, type Repo } from '@recoder/shared';
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

test('the list reads past GitLab’s first page and says when the repository had more than it keeps', async () => {
	setToken('gitlab', 'test-token');
	openMergeRequests(150);

	const list = await gitlabPullForge(REPO).list();

	expect(list.truncated).toBe(true);
	expect(list.entries).toHaveLength(PULL_LIST_REPO_MAX);
	expect(list.entries[0].pull.number).toBe(150);
});

test('a repository with fewer open merge requests than a page is read whole', async () => {
	setToken('gitlab', 'test-token');
	openMergeRequests(51);

	const list = await gitlabPullForge(REPO).list();

	expect(list).toMatchObject({ truncated: false, entries: { length: 51 } });
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

describe('gitlabMergeMethods', () => {
	test('a merge-commit project allows a merge and an optional squash', () => {
		expect(gitlabMergeMethods({ merge_method: 'merge', squash_option: 'default_off' })).toEqual(['merge', 'squash']);
	});

	test('a fast-forward project merges like a rebase', () => {
		expect(gitlabMergeMethods({ merge_method: 'ff', squash_option: 'never' })).toEqual(['rebase']);
	});

	test('a project that always squashes allows only a squash', () => {
		expect(gitlabMergeMethods({ merge_method: 'rebase_merge', squash_option: 'always' })).toEqual(['squash']);
	});
});
