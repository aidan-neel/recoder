import { describe, expect, spyOn, test } from 'bun:test';
import { recordSignIn } from '../../src/accounts/account-store';
import { createSession } from '../../src/accounts/sessions';
import { localApp as app } from '../helpers/local-app';
import * as gh from '../../src/forge/gh';
import { getToken, setToken } from '../../src/forge/tokens';
import { answerForge, useFakeForges, userAnswer } from '../helpers/fake-forge-oauth';

useFakeForges();

const GITHUB = { provider: 'github', host: null } as const;
const OWNER = { remoteId: '7', login: 'octocat', name: 'The Octocat', avatarUrl: null };
const NO_REFRESH = { refreshToken: null, expiresAt: null };

/** An account whose one linked forge is GitHub user 7, with `gho_owner` saved as the connection. */
async function accountWithGithubOwner(): Promise<void> {
	setToken('github', 'gho_owner');
	await recordSignIn({ target: GITHUB, user: OWNER, token: NO_REFRESH, linkTo: null });
}

/** Pastes `token`, which the provider CLI reports as valid for `user`. */
async function pasteToken(token: string, headers: Record<string, string> = {}): Promise<Response> {
	const check = spyOn(gh, 'ghAuth').mockResolvedValue({ authenticated: true, user: 'whoever' });

	try {
		return await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ provider: 'github', token })
		});
	} finally {
		check.mockRestore();
	}
}

describe('POST /api/auth/token while signed out', () => {
	test('signs in the account’s linked forge user: saves the token, starts a session and sets the cookie', async () => {
		await accountWithGithubOwner();
		answerForge('api.github.com/user', userAnswer(7, 'octocat-renamed'));

		const response = await pasteToken('ghp_again');
		const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];

		expect(response.status).toBe(200);
		expect(cookie).toMatch(/^recoder_session=[\w-]{43}$/);
		expect(getToken('github')).toBe('ghp_again');

		const me = await (await app.request('/api/auth/me', { headers: { cookie } })).json();

		expect(me.account.id).toBe('owner');
	});

	test('signs a stranger in as a member without saving their token', async () => {
		await accountWithGithubOwner();
		answerForge('api.github.com/user', userAnswer(8, 'mallory'));

		const response = await pasteToken('ghp_stranger');

		expect(response.status).toBe(200);
		expect(getToken('github')).toBe('gho_owner');
		expect(JSON.stringify(await response.json())).not.toContain('ghp_stranger');
	});

	test('does not let a signed-out caller aim the server at an unknown GitLab host', async () => {
		await accountWithGithubOwner();

		const response = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'gitlab', token: 'glpat_x', host: 'internal.example' })
		});

		expect(response.status).toBe(400);
	});

	test('refuses an untrusted origin', async () => {
		await accountWithGithubOwner();
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const response = await pasteToken('ghp_again', { origin: 'https://evil.example' });

		expect(response.status).toBe(403);
		expect(getToken('github')).toBe('gho_owner');
	});

	test('a forge that fails reading the profile reports it without the token', async () => {
		await accountWithGithubOwner();
		answerForge('api.github.com/user', { status: 500, body: { message: 'boom ghp_leak' } });

		const response = await pasteToken('ghp_leak');

		expect(response.status).toBe(502);
		expect(JSON.stringify(await response.json())).not.toContain('ghp_leak');
		expect(getToken('github')).toBe('gho_owner');
	});

	test('status and repos stay behind the session', async () => {
		await accountWithGithubOwner();

		expect((await app.request('/api/auth/status')).status).toBe(401);
		expect((await app.request('/api/auth/repos?provider=github')).status).toBe(401);
	});
});

describe('POST /api/auth/token while signed in', () => {
	test('links the token’s forge user and replaces the provider’s link without a new session', async () => {
		await accountWithGithubOwner();
		answerForge('api.github.com/user', userAnswer(9, 'second-login'));

		const cookie = `recoder_session=${(await createSession('owner')).token}`;
		const response = await pasteToken('ghp_replaced', { cookie });

		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(getToken('github')).toBe('ghp_replaced');
	});
});
