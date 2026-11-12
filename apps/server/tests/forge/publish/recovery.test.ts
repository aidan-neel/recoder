import { afterEach, expect, test } from 'bun:test';
import { githubComments } from '../../../src/forge/publish/github-comments';
import { gitlabComments, gitlabMergeRequest } from '../../../src/forge/publish/gitlab-comments';
import { PublishConflictError } from '../../../src/forge/publish/forge';
import { restoreFetch, stubForge } from '../../helpers/forge-fetch';

afterEach(restoreFetch);

test('GitHub finds an earlier inline comment through pull request review comments', async () => {
	const calls = stubForge(() => [
		200,
		[{ id: 17, html_url: 'https://github.com/acme/app/pull/7#discussion_r17', body: '<!-- marker -->' }]
	]);

	const comment = await githubComments('acme/app', 7, 'head').findInline('<!-- marker -->');

	expect(calls).toHaveLength(1);
	expect(calls[0].url).toBe('https://api.github.com/repos/acme/app/pulls/7/comments?per_page=100&page=1');
	expect(comment).toEqual({ id: '17', url: 'https://github.com/acme/app/pull/7#discussion_r17' });
});

test('GitLab finds an earlier inline diff note inside its discussion', async () => {
	const calls = stubForge(() => [200, [{ id: 'd27', notes: [{ id: 27, type: 'DiffNote', body: '<!-- marker -->' }] }]]);

	const comment = await gitlabComments(
		gitlabMergeRequest('acme/app', 7, 'https://git.acme/app/-/merge_requests/7', {
			GITLAB_TOKEN: 'test-token',
			GITLAB_HOST: 'git.acme'
		})
	).findInline('<!-- marker -->');

	expect(calls[0].url).toBe(
		'https://git.acme/api/v4/projects/acme%2Fapp/merge_requests/7/discussions?per_page=100&page=1'
	);

	expect(comment).toEqual({ id: '27', url: 'https://git.acme/app/-/merge_requests/7#note_27' });
});

test('an incomplete bounded marker search refuses to conclude that no earlier comment exists', async () => {
	const page = Array.from({ length: 100 }, (_, index) => ({
		id: index,
		html_url: 'https://forge.invalid/comment',
		body: 'other comment'
	}));

	const calls = stubForge(() => [200, page]);

	await expect(githubComments('acme/app', 7, 'head').find('missing-marker')).rejects.toBeInstanceOf(
		PublishConflictError
	);

	expect(calls).toHaveLength(10);
	expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
