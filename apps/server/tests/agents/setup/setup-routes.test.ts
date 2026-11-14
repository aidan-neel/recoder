import { expect, spyOn, test } from 'bun:test';
import { createSession } from '../../../src/accounts/sessions';
import { setToken } from '../../../src/forge/tokens';
import * as gh from '../../../src/forge/gh';
import { answerForge, createOwnerAccount, useFakeForges, userAnswer } from '../../helpers/fake-forge-oauth';
import { localApp as app, sendAs } from '../../helpers/local-app';

useFakeForges();

/** The admin's session cookie: GitHub user 7, `octocat`, with `gho_owner` as the forge connection. */
async function adminCookie(): Promise<string> {
	setToken('github', 'gho_owner');
	await createOwnerAccount();

	return `recoder_session=${(await createSession('owner')).token}`;
}

/** A member's session cookie: a stranger signing in as `hubot` by pasting a token. */
async function memberCookie(): Promise<string> {
	answerForge('api.github.com/user', userAnswer(21, 'hubot'));

	const check = spyOn(gh, 'ghAuth').mockResolvedValue({ authenticated: true, user: 'hubot' });

	try {
		const response = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'github', token: 'ghp_hubot' })
		});

		expect(response.status).toBe(200);

		return (response.headers.get('set-cookie') ?? '').split(';')[0];
	} finally {
		check.mockRestore();
	}
}

test('a member cannot start, feed or stop a setup job', async () => {
	await adminCookie();

	const member = await memberCookie();

	const writes: [string, string][] = [
		['POST', '/api/agent/codex/install'],
		['POST', '/api/agent/codex/sign-in'],
		['POST', '/api/agent/jobs/some-job/input'],
		['DELETE', '/api/agent/jobs/some-job']
	];

	for (const [method, path] of writes) {
		const response = await sendAs(path, method, member, { text: 'x' });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'admin-only' });
	}
});

test('a member may read a job’s state, which is 404 for one that does not exist', async () => {
	await adminCookie();

	const member = await memberCookie();
	const response = await sendAs('/api/agent/jobs/some-job', 'GET', member);

	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: 'That setup job is no longer known.' });
});

test('the setup routes answer 404 for an agent that is not registered', async () => {
	expect((await app.request('/api/agent/not-an-agent/install', { method: 'POST' })).status).toBe(404);
	expect((await app.request('/api/agent/not-an-agent/sign-in', { method: 'POST' })).status).toBe(404);
	expect((await app.request('/api/agent/jobs/not-a-job')).status).toBe(404);
});

test('job input needs a text to paste', async () => {
	const response = await app.request('/api/agent/jobs/some-job/input', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({})
	});

	expect(response.status).toBe(400);
});
