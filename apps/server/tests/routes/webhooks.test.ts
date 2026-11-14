import { afterEach, expect, test } from 'bun:test';
import type { PullState } from '@recoder/shared';
import { app } from '../../src/app';
import { env } from '../../src/env';
import { pullStateKey, pullStates } from '../../src/forge/pulls/pull-states';
import { saveAutoReviewSettings } from '../../src/forge/watch/settings';
import { db } from '../../src/store';

afterEach(() => {
	env.GITLAB_WEBHOOK_SECRET = undefined;
});

/** A GitLab note on open MR 4 of `Group/App`, addressed by its clone URL. */
const noteHook = {
	object_kind: 'note',
	project: { git_http_url: 'https://GitLab.acme.test/Group/App.git' },
	user: { username: 'ana' },
	object_attributes: { id: 90, note: '@recoder look at auth', noteable_type: 'MergeRequest', discussion_id: 'd1' },
	merge_request: { iid: 4, state: 'opened', last_commit: { id: 'abc' } }
};

async function send(token?: string): Promise<Response> {
	return app.request('/api/webhooks/gitlab', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { 'x-gitlab-token': token }) },
		body: JSON.stringify(noteHook)
	});
}

test('a GitLab webhook needs the configured secret token', async () => {
	env.GITLAB_WEBHOOK_SECRET = 's3cret';

	expect((await send()).status).toBe(401);
	expect((await send('wrong')).status).toBe(401);
	expect((await send('s3cret')).status).toBe(200);
});

test('a GitLab mention matches the tracked repository whatever URL form it uses', async () => {
	const at = new Date().toISOString();

	await db.repos.set({
		id: 'acme-app',
		name: 'group/app',
		url: 'https://gitlab.acme.test/group/app',
		provider: 'gitlab',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	});

	saveAutoReviewSettings({ enabled: true });

	const body = (await (await send()).json()) as { reason?: string };

	expect(body.reason).toContain('reviewer model');
	await db.repos.delete('acme-app');
});

test('a GitLab merge_request closed on the forge records its state without starting a review', async () => {
	const at = new Date().toISOString();

	await db.repos.set({
		id: 'merged-app',
		name: 'group/app',
		url: 'https://gitlab.acme.test/group/app',
		provider: 'gitlab',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	});

	const res = await app.request('/api/webhooks/gitlab', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			object_kind: 'merge_request',
			project: { web_url: 'https://gitlab.acme.test/group/app' },
			object_attributes: { iid: 4, state: 'merged', action: 'merge', last_commit: { id: 'abc' } }
		})
	});

	await expectStateOnly(res, 'merged-app', 4, 'merged');
});

test('a GitHub pull_request closed by merging records merged without starting a review', async () => {
	const at = new Date().toISOString();

	await db.repos.set({
		id: 'gh-app',
		name: 'acme/app',
		url: 'https://github.com/acme/app',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	});

	const res = await app.request('/api/webhooks/github', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request' },
		body: JSON.stringify({
			action: 'closed',
			repository: { html_url: 'https://github.com/acme/app' },
			pull_request: { number: 7, state: 'closed', merged: true, head: { sha: 'abc' } }
		})
	});

	await expectStateOnly(res, 'gh-app', 7, 'merged');
});

/**
 * Expects a hook that was taken without starting a review and left `state`
 * recorded for the pull request, then removes the repository and the record.
 */
async function expectStateOnly(res: Response, repoId: string, n: number, state: PullState): Promise<void> {
	expect(res.status).toBe(200);
	expect(await res.json()).toMatchObject({ received: true, reviewCreated: false });
	expect((await pullStates.get(pullStateKey(repoId, n)))?.state).toBe(state);

	await db.repos.delete(repoId);
	await pullStates.delete(pullStateKey(repoId, n));
}
