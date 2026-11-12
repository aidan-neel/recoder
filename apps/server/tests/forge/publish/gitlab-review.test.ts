import { afterEach, expect, test } from 'bun:test';
import { gitlabComments, gitlabMergeRequest } from '../../../src/forge/publish/gitlab-comments';
import type { ReviewDraft } from '../../../src/forge/publish/forge';
import { gitlabReviews } from '../../../src/forge/publish/gitlab-review';
import { restoreFetch, stubForge, type ForgeCall } from '../../helpers/forge-fetch';

const ENV = { GITLAB_TOKEN: 'glpat', GITLAB_HOST: 'git.acme.dev' };
const PROJECT = 'https://git.acme.dev/api/v4/projects/team%2Fapp';
const MR = `${PROJECT}/merge_requests/9`;
const MR_URL = 'https://git.acme.dev/team/app/-/merge_requests/9';

afterEach(restoreFetch);

function reviews() {
	const mergeRequest = gitlabMergeRequest('team/app', 9, MR_URL, ENV);

	return gitlabReviews(mergeRequest, gitlabComments(mergeRequest));
}

function draft(marker: string, newLine: number): ReviewDraft {
	return {
		marker,
		body: `${marker} body`,
		target: { path: 'src/a.ts', oldPath: 'src/a.ts', side: 'new', oldLine: null, newLine },
		span: 0
	};
}

/** A merge request with `discussions`, whose diff refuses notes on line 99 and whose discussions resolve. */
function fakeGitlab(discussions: unknown[] = []): ForgeCall[] {
	return stubForge((call) => {
		const path = call.url.split('?')[0];

		if (call.method === 'GET' && path === `${MR}/discussions`) return [200, discussions];
		if (call.method === 'GET' && path === MR)
			return [200, { web_url: MR_URL, diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'h' } }];

		if (call.method === 'POST' && path === `${MR}/discussions`) {
			const position = call.body?.position as { new_line?: number };

			return position.new_line === 99
				? [400, { message: 'line_code can’t be blank' }]
				: [201, { id: 'd', notes: [{ id: 70 }] }];
		}

		if (call.method === 'POST' && path === `${MR}/notes`) return [201, { id: 80 }];
		if (call.method === 'PUT' && path.startsWith(`${MR}/discussions/`)) return [200, {}];

		return [500, { message: `unexpected ${call.method} ${path}` }];
	});
}

test('posts each finding as a positioned discussion, then the summary listing what GitLab refused', async () => {
	const calls = fakeGitlab();
	const refusedSeen: string[] = [];

	const summary = await reviews().submitReview([draft('<!-- a -->', 3), draft('<!-- b -->', 99)], (refused) => {
		refusedSeen.push(...refused.map((item) => item.marker));

		return 'summary';
	});

	const posts = calls.filter((call) => call.method === 'POST');

	expect(posts.map((call) => call.url)).toEqual([`${MR}/discussions`, `${MR}/discussions`, `${MR}/notes`]);

	expect(posts[0].body?.position).toMatchObject({
		position_type: 'text',
		head_sha: 'h',
		new_path: 'src/a.ts',
		new_line: 3
	});

	expect(refusedSeen).toEqual(['<!-- b -->']);
	expect(summary).toEqual({ id: '80', url: `${MR_URL}#note_80` });
});

test('a discussion an earlier attempt already posted is not posted again', async () => {
	const calls = fakeGitlab([{ id: 'd1', notes: [{ id: 61, type: 'DiffNote', body: '<!-- a --> body' }] }]);

	await reviews().submitReview([draft('<!-- a -->', 3)], () => 'summary');

	expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([`${MR}/notes`]);
});

test('resolves the discussion an inline note started, and leaves a resolved one alone', async () => {
	const calls = fakeGitlab([
		{ id: 'open', notes: [{ id: 61, type: 'DiffNote', body: 'x', resolved: false }] },
		{ id: 'done', notes: [{ id: 62, type: 'DiffNote', body: 'y', resolved: true }] }
	]);

	expect(await reviews().resolveThread('61')).toBe(true);
	expect(await reviews().resolveThread('62')).toBe(false);

	expect(calls.filter((call) => call.method === 'PUT').map((call) => [call.url, call.body])).toEqual([
		[`${MR}/discussions/open`, { resolved: true }]
	]);
});

test('sets the commit status, and treats GitLab refusing the same state again as already set', async () => {
	let answered = false;

	const calls = stubForge(() => {
		if (answered) return [400, { message: 'Cannot transition status via :success from :success' }];
		answered = true;

		return [201, {}];
	});

	const status = { sha: 'abc', state: 'failure' as const, description: '1 verified finding at error', url: MR_URL };

	await reviews().setStatus(status);
	await reviews().setStatus(status);

	expect(calls[0].url).toBe(`${PROJECT}/statuses/abc`);

	expect(calls[0].body).toEqual({
		state: 'failed',
		name: 'recoder',
		description: status.description,
		target_url: MR_URL
	});
});
