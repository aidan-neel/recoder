import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { findAdmin } from '../../src/accounts/account-store';
import { REDIRECT_TTL_MS, beginRedirect, claimRedirect } from '../../src/accounts/oauth-redirects';
import { removeMember } from '../../src/accounts/members';
import { collection } from '../../src/storage/backend';
import { env } from '../../src/env';
import { getToken } from '../../src/forge/tokens';
import { useFakeClock } from '../helpers/fake-clock';
import {
	answerForge,
	codeExchangeAnswer,
	createOwnerAccount,
	forgeCalls,
	useFakeForges,
	userAnswer
} from '../helpers/fake-forge-oauth';
import { localApp, requestFrom } from '../helpers/local-app';

useFakeForges();
useFakeClock();

const FRONTEND = new URL(env.FRONTEND_URL).origin;
const TAILNET_PEER = '100.64.0.7';

beforeEach(() => {
	process.env.RECODER_GITHUB_CLIENT_SECRET = 'github-secret';
	process.env.RECODER_GITLAB_CLIENT_SECRET = 'gitlab-secret';
});

/** The query of the redirect's `Location`, which names the authorize page the person lands on. */
function authorizeQuery(response: Response): URLSearchParams {
	return new URL(response.headers.get('location') ?? '').searchParams;
}

function cookieValue(response: Response, name: string): string | undefined {
	return response.headers
		.getSetCookie()
		.map((header) => header.split(';')[0])
		.find((pair) => pair.startsWith(`${name}=`))
		?.slice(name.length + 1);
}

/** Starts a GitHub redirect sign-in and returns what the forge page and the browser now hold. */
async function startGithub(query = '') {
	const response = await localApp.request(`/api/auth/oauth/github/start${query}`);

	return {
		response,
		state: authorizeQuery(response).get('state') ?? '',
		nonce: cookieValue(response, 'recoder_oauth') ?? ''
	};
}

function callback(provider: string, query: Record<string, string>, nonce?: string): Promise<Response> {
	const headers: Record<string, string> = nonce ? { cookie: `recoder_oauth=${nonce}` } : {};

	return localApp.request(`/api/auth/oauth/${provider}/callback?${new URLSearchParams(query)}`, { headers });
}

function answerGithubUser(id: number, login: string): void {
	answerForge('github.com/login/oauth/access_token', codeExchangeAnswer());
	answerForge('api.github.com/user', userAnswer(id, login));
}

function errorCode(response: Response): string | null {
	return new URL(response.headers.get('location') ?? '').searchParams.get('signin-error');
}

describe('the method a forge signs in by', () => {
	test('is redirect with a client id and secret, device with only the id, and null with neither', async () => {
		delete process.env.RECODER_GITLAB_CLIENT_SECRET;
		delete process.env.RECODER_GITHUB_CLIENT_ID;

		const me = await (await localApp.request('/api/auth/me')).json();

		expect(me.forges).toEqual([
			{ provider: 'github', method: null },
			{ provider: 'gitlab', method: 'device' }
		]);

		process.env.RECODER_GITHUB_CLIENT_ID = 'github-client';

		expect((await (await localApp.request('/api/auth/me')).json()).forges[0]).toEqual({
			provider: 'github',
			method: 'redirect'
		});
	});
});

describe('starting a redirect sign-in', () => {
	test('redirects to the forge with a state, a PKCE challenge and the scopes, and sets the nonce cookie', async () => {
		const { response, state, nonce } = await startGithub();
		const query = authorizeQuery(response);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toStartWith('https://github.com/login/oauth/authorize?');
		expect(state).toHaveLength(43);
		expect(query.get('client_id')).toBe('github-client');
		expect(query.get('scope')).toBe('repo read:user read:org');
		expect(query.get('code_challenge_method')).toBe('S256');
		expect(query.get('redirect_uri')).toBe('http://localhost/api/auth/oauth/github/callback');

		const cookie = response.headers.getSetCookie().find((header) => header.startsWith('recoder_oauth='));

		expect(nonce).toHaveLength(43);
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).not.toContain('Secure');
	});

	test('builds the callback address from the public URL when one is set, and https from a proxy', async () => {
		const proxied = await localApp.request('/api/auth/oauth/github/start', {
			headers: { 'x-forwarded-proto': 'https' }
		});

		expect(authorizeQuery(proxied).get('redirect_uri')).toBe('https://localhost/api/auth/oauth/github/callback');
		expect(proxied.headers.getSetCookie()[0]).toContain('Secure');

		process.env.RECODER_PUBLIC_URL = 'https://recoder.example.ts.net/';

		const configured = await localApp.request('/api/auth/oauth/gitlab/start?host=gitlab.example.com');

		expect(configured.headers.get('location')).toStartWith('https://gitlab.example.com/oauth/authorize?');

		expect(authorizeQuery(configured).get('redirect_uri')).toBe(
			'https://recoder.example.ts.net/api/auth/oauth/gitlab/callback'
		);
	});

	test('is refused while setup is locked for this browser', async () => {
		const response = await requestFrom(TAILNET_PEER, '/api/auth/oauth/github/start', {
			headers: { 'x-forwarded-for': '100.64.0.9' }
		});

		expect(response.status).toBe(302);
		expect(errorCode(response)).toBe('setup-locked');
		expect(response.headers.getSetCookie()).toHaveLength(0);
	});

	test('is refused for a forge that has no secret', async () => {
		delete process.env.RECODER_GITHUB_CLIENT_SECRET;

		expect(errorCode(await localApp.request('/api/auth/oauth/github/start'))).toBe('failed');
	});
});

describe('the callback', () => {
	test('creates the admin during setup, trades the code with the secret and verifier, and sets the session', async () => {
		answerGithubUser(7, 'octocat');

		const { response: started, state, nonce } = await startGithub('?return=/pulls/acme/app/3');
		const response = await callback('github', { code: 'the-code', state }, nonce);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${FRONTEND}/pulls/acme/app/3`);
		expect(cookieValue(response, 'recoder_session')).toHaveLength(43);
		expect((await findAdmin())?.forges[0].login).toBe('octocat');

		const exchange = forgeCalls()[0];
		const verifier = exchange.form.code_verifier;

		expect(exchange.form).toMatchObject({
			client_id: 'github-client',
			client_secret: 'github-secret',
			code: 'the-code',
			grant_type: 'authorization_code',
			redirect_uri: 'http://localhost/api/auth/oauth/github/callback'
		});

		expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
			authorizeQuery(started).get('code_challenge') ?? ''
		);
	});

	test('signs a stranger in as a member and leaves the forge connection as it was', async () => {
		await createOwnerAccount();
		answerGithubUser(9, 'hubot');

		const { state, nonce } = await startGithub();
		const response = await callback('github', { code: 'c', state }, nonce);

		expect(response.headers.get('location')).toBe(`${FRONTEND}/`);
		expect(cookieValue(response, 'recoder_session')).toHaveLength(43);
		expect(getToken('github')).toBeUndefined();
	});

	test('sends a removed member back with removed and no session', async () => {
		await createOwnerAccount();
		answerGithubUser(99, 'stranger');

		const first = await startGithub();

		await callback('github', { code: 'c', state: first.state }, first.nonce);
		await removeMember('member:github::99');

		const { state, nonce } = await startGithub();
		const response = await callback('github', { code: 'c', state }, nonce);

		expect(errorCode(response)).toBe('removed');
		expect(cookieValue(response, 'recoder_session')).toBeUndefined();
	});

	test('accepts a state only once', async () => {
		answerGithubUser(7, 'octocat');

		const { state, nonce } = await startGithub();

		expect((await callback('github', { code: 'c', state }, nonce)).headers.get('location')).toBe(`${FRONTEND}/`);
		expect(errorCode(await callback('github', { code: 'c', state }, nonce))).toBe('expired');
	});

	test('rejects a state older than ten minutes', async () => {
		const { state, nonce } = await startGithub();

		jest.setSystemTime(Date.now() + REDIRECT_TTL_MS + 1);

		expect(errorCode(await callback('github', { code: 'c', state }, nonce))).toBe('expired');
		expect(forgeCalls()).toHaveLength(0);
	});

	test('rejects a state whose nonce cookie is wrong or missing, and spends it', async () => {
		const first = await startGithub();

		expect(errorCode(await callback('github', { code: 'c', state: first.state }, 'someone-elses'))).toBe('failed');
		expect(errorCode(await callback('github', { code: 'c', state: first.state }, first.nonce))).toBe('expired');

		const second = await startGithub();

		expect(errorCode(await callback('github', { code: 'c', state: second.state }))).toBe('failed');
		expect(forgeCalls()).toHaveLength(0);
	});

	test('reports a denied authorization', async () => {
		const { state, nonce } = await startGithub();

		expect(errorCode(await callback('github', { error: 'access_denied', state }, nonce))).toBe('denied');
		expect(await findAdmin()).toBeUndefined();
	});

	test('rejects a state started for another forge', async () => {
		const { state, nonce } = await startGithub();

		expect(errorCode(await callback('gitlab', { code: 'c', state }, nonce))).toBe('failed');
	});

	test('reports a code the forge refuses as failed', async () => {
		answerForge('github.com/login/oauth/access_token', { body: { error: 'bad_verification_code' } });

		const { state, nonce } = await startGithub();

		expect(errorCode(await callback('github', { code: 'c', state }, nonce))).toBe('failed');
	});

	test.each([
		['//evil.example/x', '/'],
		['/\\evil.example', '/'],
		['https://evil.example/', '/'],
		['relative', '/'],
		['/pulls?tab=bugs#top', '/pulls?tab=bugs']
	])('lands on %s as %s', async (requested, landed) => {
		answerGithubUser(7, 'octocat');

		const { state, nonce } = await startGithub(`?return=${encodeURIComponent(requested)}`);
		const response = await callback('github', { code: 'c', state }, nonce);

		expect(response.headers.get('location')).toBe(`${FRONTEND}${landed}`);
	});
});

describe('the PKCE verifier a redirect keeps', () => {
	test('is stored sealed and still proves the challenge when the redirect is claimed', async () => {
		const begun = await beginRedirect({ provider: 'github', host: null }, '/pulls');

		const stored = (await collection<{ id: string; codeVerifier: string }>('oauth_redirects').list()).find(
			(redirect) => redirect.id === createHash('sha256').update(begun.state).digest('hex')
		);

		expect(stored?.codeVerifier).toStartWith('enc:v1:');

		const claim = await claimRedirect(begun.state, begun.nonce);

		expect(claim.kind).toBe('claimed');

		if (claim.kind !== 'claimed') return;

		expect(createHash('sha256').update(claim.redirect.codeVerifier).digest('base64url')).toBe(begun.codeChallenge);
	});
});
