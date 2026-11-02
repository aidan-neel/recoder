import { afterEach, expect, test } from 'bun:test';
import { app } from '../../src/app';
import { env } from '../../src/env';
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

	db.repos.set({
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

	db.repos.delete('acme-app');
});
