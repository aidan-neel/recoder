import { describe, expect, spyOn, test } from 'bun:test';
import { findAdmin } from '../../src/accounts/account-store';
import { localApp as app, requestFrom } from '../helpers/local-app';
import * as gh from '../../src/forge/gh';
import { setGitlabHost } from '../../src/forge/gitlab-host';
import { getToken, setToken } from '../../src/forge/tokens';
import {
	answerForge,
	connectForges,
	createOwnerAccount,
	forgeCalls,
	useFakeForges,
	userAnswer
} from '../helpers/fake-forge-oauth';

useFakeForges();

function adopt(provider: string): Promise<Response> {
	return Promise.resolve(
		app.request('/api/auth/adopt', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider })
		})
	);
}

describe('GET /api/auth/me during setup', () => {
	test('lists the connections the server already has, from the forge status', async () => {
		connectForges({ github: 'octocat', gitlab: 'tanuki' });
		setGitlabHost('git.acme.test');

		const me = await (await app.request('/api/auth/me')).json();

		expect(me.connected).toEqual([
			{ provider: 'github', host: null, login: 'octocat' },
			{ provider: 'gitlab', host: 'git.acme.test', login: 'tanuki' }
		]);
	});

	test('is empty once an account exists', async () => {
		connectForges({ github: 'octocat' });
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));
		setToken('github', 'gho_saved');
		await adopt('github');

		const cookie = { cookie: `recoder_session=${await sessionOf(await findAdmin())}` };
		const me = await (await app.request('/api/auth/me', { headers: cookie })).json();

		expect(me).toMatchObject({ setup: false, connected: [] });
	});
});

/** A session cookie value for the account, made directly. */
async function sessionOf(account: Awaited<ReturnType<typeof findAdmin>>): Promise<string> {
	const { createSession } = await import('../../src/accounts/sessions');

	return (await createSession(account?.id ?? 'owner')).token;
}

describe('POST /api/auth/adopt', () => {
	test('makes the owner account from a saved token’s identity and signs the owner in', async () => {
		setToken('github', 'gho_saved');
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const response = await adopt('github');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.account).toMatchObject({ id: 'owner', name: 'Name of octocat', forges: [{ login: 'octocat' }] });
		expect(response.headers.get('set-cookie')).toMatch(/^recoder_session=[\w-]{43}; .*HttpOnly/);

		expect(forgeCalls().map((call) => [call.url, call.authorization])).toEqual([
			['https://api.github.com/user', 'Bearer gho_saved']
		]);

		expect(getToken('github')).toBe('gho_saved');
	});

	test('reads the identity from the signed-in CLI when no token is saved', async () => {
		const cli = spyOn(gh, 'gh').mockResolvedValue(JSON.stringify({ id: 12, login: 'cli-user', name: null }));

		try {
			const response = await adopt('github');

			expect((await response.json()).account.forges[0].login).toBe('cli-user');
			expect(cli).toHaveBeenCalledWith(['api', 'user'], {});
		} finally {
			cli.mockRestore();
		}
	});

	test('of two racing adopts only one creates the account', async () => {
		setToken('github', 'gho_saved');
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const statuses = (await Promise.all([adopt('github'), adopt('github')])).map((response) => response.status);

		expect(statuses.sort()).toEqual([200, 409]);
	});

	test('with no connection it fails and creates nothing', async () => {
		const cli = spyOn(gh, 'gh').mockRejectedValue(new gh.GhError('auth', 'not authenticated'));

		try {
			const response = await adopt('github');

			expect(response.status).toBe(400);
			expect(await findAdmin()).toBeUndefined();
		} finally {
			cli.mockRestore();
		}
	});

	test('refuses an unknown provider and an untrusted origin', async () => {
		const other = await app.request('/api/auth/adopt', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
			body: JSON.stringify({ provider: 'github' })
		});

		expect((await adopt('local')).status).toBe(400);
		expect(other.status).toBe(403);
	});

	test('no token reaches an error body', async () => {
		setToken('github', 'gho_leaky');
		answerForge('api.github.com/user', { status: 401, body: { message: 'bad credentials gho_leaky' } });

		const response = await adopt('github');

		expect(response.status).toBe(502);
		expect(JSON.stringify(await response.json())).not.toContain('gho_leaky');
	});
});

describe('signing back in with a connection once an account exists', () => {
	const PROXIED = { 'x-forwarded-for': '100.64.0.9' };

	function signedOutMe(headers: Record<string, string> = {}): Promise<Response> {
		return requestFrom('127.0.0.1', '/api/auth/me', { headers });
	}

	function adoptFrom(headers: Record<string, string> = {}): Promise<Response> {
		return requestFrom('127.0.0.1', '/api/auth/adopt', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ provider: 'github' })
		});
	}

	test('on the server’s machine lists the matching connection and signs in with a new session, changing nothing', async () => {
		await createOwnerAccount();
		connectForges({ github: 'OctoCat' });
		setToken('github', 'gho_saved');
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const me = await (await signedOutMe()).json();
		const response = await adoptFrom();

		expect(me.connected).toEqual([{ provider: 'github', host: null, login: 'OctoCat' }]);
		expect(response.status).toBe(200);
		expect((await response.json()).account).toMatchObject({ id: 'owner', role: 'admin' });
		expect(response.headers.get('set-cookie')).toMatch(/^recoder_session=[\w-]{43}; /);
		expect(getToken('github')).toBe('gho_saved');
		expect((await findAdmin())?.forges).toHaveLength(1);
	});

	test('through a proxy lists nothing and refuses', async () => {
		await createOwnerAccount();
		connectForges({ github: 'octocat' });
		setToken('github', 'gho_saved');
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const me = await (await signedOutMe(PROXIED)).json();
		const response = await adoptFrom(PROXIED);

		expect(me.connected).toEqual([]);
		expect(response.status).toBe(403);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(forgeCalls()).toHaveLength(0);
	});

	test('a connection that matches no account is not listed and is refused', async () => {
		await createOwnerAccount();
		connectForges({ github: 'stranger' });
		setToken('github', 'gho_stranger');
		answerForge('api.github.com/user', userAnswer(99, 'stranger'));

		const me = await (await signedOutMe()).json();
		const response = await adoptFrom();

		expect(me.connected).toEqual([]);
		expect(response.status).toBe(403);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(getToken('github')).toBe('gho_stranger');
		expect((await findAdmin())?.forges.map((forge) => forge.login)).toEqual(['octocat']);
	});
});
