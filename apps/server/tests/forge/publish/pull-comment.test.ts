import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Review } from '@recoder/shared';
import { publishPullComment } from '../../../src/forge/publish/pull-comment';
import { pullCommentMarker } from '../../../src/forge/publish/render';
import { setToken } from '../../../src/forge/tokens';
import { db } from '../../../src/store';
import { restoreFetch, stubForge, type ForgeCall } from '../../helpers/forge-fetch';
import { testReview } from '../../helpers/review';

const ISSUE_COMMENTS = 'https://api.github.com/repos/acme/app/issues/7/comments';
const COMMENT = { id: 501, html_url: 'https://github.com/acme/app/pull/7#issuecomment-501' };

let repoId = '';

/** GitHub with no comments yet: posting creates comment 501, editing answers it. */
function freshPull(existing: unknown[] = []): ForgeCall[] {
	return stubForge((call) => (call.method === 'GET' ? [200, existing] : [call.method === 'POST' ? 201 : 200, COMMENT]));
}

function review(overrides: Partial<Review> = {}): Review {
	return db.reviews.set(testReview({ repoId, prNumber: 7, headSha: 'abcdef1234', status: 'passed', ...overrides }));
}

beforeEach(() => {
	const now = new Date().toISOString();

	repoId = crypto.randomUUID();

	db.repos.set({
		id: repoId,
		name: 'acme/app',
		url: 'https://github.com/acme/app',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	setToken('github', 'write-token');
});

afterEach(() => {
	restoreFetch();
	for (const row of db.reviews.list()) if (row.repoId === repoId) db.reviews.delete(row.id);
	db.repos.delete(repoId);
});

test('posts the comment once, then edits it in place', async () => {
	const calls = freshPull();
	const { id } = review();

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

	const { id } = review();

	await publishPullComment(id);

	expect(calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`)).toEqual([
		'PATCH https://api.github.com/repos/acme/app/issues/comments/501'
	]);
});

test('a newer review of the pull request edits the comment the earlier one posted', async () => {
	const calls = freshPull();
	const old = review({ createdAt: '2026-01-01T00:00:00.000Z' });

	await publishPullComment(old.id);

	calls.length = 0;

	const next = review({ headSha: 'fedcba9876' });

	await publishPullComment(next.id);

	expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
		'PATCH https://api.github.com/repos/acme/app/issues/comments/501'
	]);

	expect(String(calls[0].body?.body)).toContain('`fedcba9`');
	await expect(publishPullComment(old.id)).rejects.toThrow('newer review');
});

test('saves a forge failure on the review for the page to show', async () => {
	stubForge(() => [500, { message: 'boom' }]);

	const { id } = review();

	await expect(publishPullComment(id)).rejects.toThrow('boom');
	expect(db.reviews.get(id)?.pullComment).toMatchObject({ state: 'failed', error: expect.stringContaining('boom') });
});
