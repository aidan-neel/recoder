import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Review } from '@recoder/shared';
import { publishPullComment } from '../../../src/forge/publish/pull-comment';
import { pullCommentMarker } from '../../../src/forge/publish/render';
import { db } from '../../../src/store';
import { restoreFetch, stubForge, type ForgeCall } from '../../helpers/forge-fetch';
import { forgetRepo, trackGithubRepo } from '../../helpers/forge-repo';
import { testReview } from '../../helpers/review';

const ISSUE_COMMENTS = 'https://api.github.com/repos/acme/app/issues/7/comments';
const COMMENT = { id: 501, html_url: 'https://github.com/acme/app/pull/7#issuecomment-501' };

let repoId = '';

/** GitHub with no comments yet: posting creates comment 501, editing answers it. */
function freshPull(existing: unknown[] = []): ForgeCall[] {
	return stubForge((call) => (call.method === 'GET' ? [200, existing] : [call.method === 'POST' ? 201 : 200, COMMENT]));
}

async function review(overrides: Partial<Review> = {}): Promise<Review> {
	return await db.reviews.set(
		testReview({ repoId, prNumber: 7, headSha: 'abcdef1234', status: 'passed', ...overrides })
	);
}

beforeEach(async () => {
	repoId = await trackGithubRepo();
});

afterEach(async () => {
	restoreFetch();
	await forgetRepo(repoId);
});

test('posts the comment once, then edits it in place', async () => {
	const calls = freshPull();
	const { id } = await review();

	const first = await publishPullComment(id);

	expect(calls.map((call) => `${call.method} ${call.url.split('?')[0]}`)).toEqual([
		`GET ${ISSUE_COMMENTS}`,
		`POST ${ISSUE_COMMENTS}`
	]);

	expect(first.pullComment).toMatchObject({ id: '501', url: COMMENT.html_url, state: 'posted' });
	calls.length = 0;
	await publishPullComment(id);

	expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
		'PATCH https://api.github.com/repos/acme/app/issues/comments/501'
	]);
});

test('finds its earlier comment by marker when the record was lost', async () => {
	const calls = freshPull([
		{ id: 400, body: 'a person', html_url: 'x' },
		{ id: 501, body: `${pullCommentMarker(7)}\nold`, html_url: COMMENT.html_url }
	]);

	const { id } = await review();

	await publishPullComment(id);

	expect(calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`)).toEqual([
		'PATCH https://api.github.com/repos/acme/app/issues/comments/501'
	]);
});

test('a newer review of the pull request edits the comment the earlier one posted', async () => {
	const calls = freshPull();
	const old = await review({ createdAt: '2026-01-01T00:00:00.000Z' });

	await publishPullComment(old.id);
	calls.length = 0;

	const next = await review({ headSha: 'fedcba9876' });

	await publishPullComment(next.id);

	expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
		'PATCH https://api.github.com/repos/acme/app/issues/comments/501'
	]);

	expect(String(calls[0].body?.body)).toContain('`fedcba9`');
	await expect(publishPullComment(old.id)).rejects.toThrow('newer review');
});

test('saves a forge failure on the review for the page to show', async () => {
	stubForge(() => [500, { message: 'boom' }]);

	const { id } = await review();

	await expect(publishPullComment(id)).rejects.toThrow('boom');

	expect((await db.reviews.get(id))?.pullComment).toMatchObject({
		state: 'failed',
		error: expect.stringContaining('boom')
	});
});
