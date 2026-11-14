import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordSignIn } from '../../src/accounts/account-store';
import { clientAccessToken, serverAccessToken } from '../../src/accounts/local-access-token';
import { createSession, SESSION_TTL_MS } from '../../src/accounts/sessions';
import { localApp as app } from '../helpers/local-app';
import { env } from '../../src/env';
import { restoreEnvAfterEach } from '../helpers/env';
import { useFakeForges } from '../helpers/fake-forge-oauth';

useFakeForges();
restoreEnvAfterEach(['RECODER_DATA_DIR']);

const GITHUB = { provider: 'github', host: null } as const;
const USER = { remoteId: '7', login: 'octocat', name: 'The Octocat', avatarUrl: null };
const TOKEN = { accessToken: 'gho_enforce', refreshToken: null, expiresAt: null };

/** Makes the server's account and returns a session cookie header for it. */
async function signedInCookie(): Promise<string> {
	await recordSignIn({ target: GITHUB, user: USER, token: TOKEN, linkTo: null });

	return `recoder_session=${(await createSession('owner')).token}`;
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
	return app.request(path, { headers });
}

describe('while the server has no account', () => {
	test('the API is open, as before accounts', async () => {
		expect((await get('/api/repos')).status).toBe(200);
	});

	test('me reports the setup state and which forges can sign in', async () => {
		delete process.env.RECODER_GITLAB_CLIENT_ID;

		expect(await (await get('/api/auth/me')).json()).toEqual({
			account: null,
			setup: true,
			connected: [],
			setupLocked: false,
			forges: [
				{ provider: 'github', method: 'device' },
				{ provider: 'gitlab', method: null }
			]
		});
	});
});

describe('once an account exists', () => {
	test('a request without a session is refused as signed-out', async () => {
		await signedInCookie();

		const response = await get('/api/repos');

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Sign in to continue.', kind: 'signed-out' });
	});

	test('a request with a valid session cookie goes through', async () => {
		const cookie = await signedInCookie();

		expect((await get('/api/repos', { cookie })).status).toBe(200);
	});

	test.each(['recoder_session=', `recoder_session=${'A'.repeat(43)}`, 'recoder_session=garbage'])(
		'the cookie %p is refused',
		async (cookie) => {
			await signedInCookie();

			expect((await get('/api/repos', { cookie })).status).toBe(401);
		}
	);

	test('an expired session is refused', async () => {
		await recordSignIn({ target: GITHUB, user: USER, token: TOKEN, linkTo: null });

		const stale = await createSession('owner', Date.now() - SESSION_TTL_MS - 1000);

		expect((await get('/api/repos', { cookie: `recoder_session=${stale.token}` })).status).toBe(401);
	});

	test('the forge token routes under /api/auth need a session too', async () => {
		await signedInCookie();

		expect((await get('/api/auth/status')).status).toBe(401);
		expect((await app.request('/api/auth/token/github', { method: 'DELETE' })).status).toBe(401);
	});

	test('me, device sign-in and logout stay reachable without a session', async () => {
		await signedInCookie();

		const me = await (await get('/api/auth/me')).json();

		expect(me).toMatchObject({ account: null, setup: false });
		expect((await app.request('/api/auth/logout', { method: 'POST' })).status).toBe(200);
		expect((await app.request('/api/auth/device/unknown')).status).toBe(200);
	});

	test('me names the signed-in account without the forge ids or refresh state', async () => {
		const cookie = await signedInCookie();
		const me = await (await get('/api/auth/me', { cookie })).json();

		expect(me.account).toMatchObject({
			id: 'owner',
			name: 'The Octocat',
			forges: [{ provider: 'github', login: 'octocat' }]
		});

		expect(JSON.stringify(me)).not.toMatch(/remoteId|refresh/);
	});

	test('webhooks and health answer without a session', async () => {
		await signedInCookie();

		const hook = await app.request('/api/webhooks/github', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});

		expect(hook.status).not.toBe(401);
		expect((await get('/health')).status).toBe(200);
	});

	test('a change from an origin that is not the app is refused even with a valid session', async () => {
		const cookie = await signedInCookie();

		const response = await app.request('/api/auth/token/github', {
			method: 'DELETE',
			headers: { cookie, origin: 'https://evil.example' }
		});

		expect(response.status).toBe(403);
	});

	test('a change from the app’s own origin goes through', async () => {
		const cookie = await signedInCookie();

		const response = await app.request('/api/auth/token/github', {
			method: 'DELETE',
			headers: { cookie, origin: new URL(env.FRONTEND_URL).origin }
		});

		expect(response.status).toBe(200);
	});

	test('the app origin may send credentials and any other origin gets the open wildcard', async () => {
		const own = await get('/api/auth/me', { origin: new URL(env.FRONTEND_URL).origin });
		const other = await app.request('/health', { headers: { origin: 'https://other.example' } });

		expect(own.headers.get('access-control-allow-origin')).toBe(new URL(env.FRONTEND_URL).origin);
		expect(own.headers.get('access-control-allow-credentials')).toBe('true');
		expect(other.headers.get('access-control-allow-origin')).toBe('*');
	});

	test('a session close to its refresh point gets its cookie sent again with the new expiry', async () => {
		await recordSignIn({ target: GITHUB, user: USER, token: TOKEN, linkTo: null });

		const dayAgo = await createSession('owner', Date.now() - 25 * 60 * 60 * 1000);
		const response = await get('/api/repos', { cookie: `recoder_session=${dayAgo.token}` });

		expect(response.headers.get('set-cookie')).toMatch(/recoder_session=.*HttpOnly.*SameSite=Lax/i);
	});
});

describe('the machine’s API token', () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), 'recoder-api-token-'));
		process.env.RECODER_DATA_DIR = dataDir;
	});

	test('is created once with owner-only permissions and read back by a client on the same data dir', () => {
		const token = serverAccessToken();

		expect(token).toHaveLength(43);
		expect(serverAccessToken()).toBe(token);
		expect(clientAccessToken()).toBe(token);
		expect(statSync(join(dataDir, 'api-token')).mode & 0o777).toBe(0o600);
		expect(readFileSync(join(dataDir, 'api-token'), 'utf8')).toBe(token ?? '');
	});

	test('lets a program without a cookie through once an account exists, and a wrong one not', async () => {
		await signedInCookie();

		const token = serverAccessToken();

		expect((await get('/api/repos', { authorization: `Bearer ${token}` })).status).toBe(200);
		expect((await get('/api/repos', { authorization: `Bearer ${token}x` })).status).toBe(401);
		expect((await get('/api/repos', { authorization: 'Bearer ' })).status).toBe(401);
	});

	test('RECODER_API_TOKEN replaces the file', async () => {
		process.env.RECODER_API_TOKEN = 'configured-token-'.padEnd(40, 'x');
		await signedInCookie();

		expect(serverAccessToken()).toBe(process.env.RECODER_API_TOKEN);
		expect((await get('/api/repos', { authorization: `Bearer ${process.env.RECODER_API_TOKEN}` })).status).toBe(200);
	});
});

afterEach(() => {
	delete process.env.RECODER_API_TOKEN;
});
