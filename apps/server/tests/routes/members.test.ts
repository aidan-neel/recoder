import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { Account, Member } from '@recoder/shared';
import type { StoredAccount } from '../../src/accounts/account-records';
import { findAdmin, findLinkedForge, recordSignIn } from '../../src/accounts/account-store';
import { createSession } from '../../src/accounts/sessions';
import * as gh from '../../src/forge/gh';
import { getToken, setToken } from '../../src/forge/tokens';
import { newChat } from '../../src/repo-chat/chat-record';
import { collection } from '../../src/storage/backend';
import { db } from '../../src/store';
import { answerForge, createOwnerAccount, useFakeForges, userAnswer } from '../helpers/fake-forge-oauth';
import { localApp as app, sendAs } from '../helpers/local-app';
import { testReview } from '../helpers/review';

useFakeForges();

afterEach(async () => {
	await db.repoChats.clear();
	await db.reviews.clear();
});

const GITHUB = { provider: 'github', host: null } as const;
const NO_REFRESH = { refreshToken: null, expiresAt: null };

/** The admin (GitHub user 7, `octocat`) with `gho_owner` as the server's forge connection, and a session cookie. */
async function adminCookie(): Promise<string> {
	setToken('github', 'gho_owner');
	await createOwnerAccount();

	return `recoder_session=${(await createSession('owner')).token}`;
}

/** Pastes `token` as the forge user `login` (id `remoteId`) while signed out; answers the response and its cookie. */
async function pasteToken(
	login: string,
	remoteId: number,
	token = `ghp_${login}`
): Promise<{ response: Response; cookie: string }> {
	answerForge('api.github.com/user', userAnswer(remoteId, login));

	const check = spyOn(gh, 'ghAuth').mockResolvedValue({ authenticated: true, user: login });

	try {
		const response = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'github', token })
		});

		return { response, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
	} finally {
		check.mockRestore();
	}
}

async function me(cookie: string): Promise<Account | null> {
	return (await (await app.request('/api/auth/me', { headers: { cookie } })).json()).account;
}

/** A member signed in: a stranger who signs in as `login` with `ghp_<login>`. Returns the cookie. */
async function memberCookie(login = 'hubot', remoteId = 21): Promise<string> {
	const { response, cookie } = await pasteToken(login, remoteId);

	expect(response.status).toBe(200);

	return cookie;
}

describe('the setup account', () => {
	test('is the admin', async () => {
		const { response, cookie } = await pasteToken('octocat', 7);

		expect(response.status).toBe(200);
		expect(await me(cookie)).toMatchObject({ id: 'owner', role: 'admin' });
	});

	test('written before roles existed loads as the admin', async () => {
		const at = '2026-01-01T00:00:00.000Z';

		await collection<Omit<StoredAccount, 'role'>>('accounts').set({
			id: 'owner',
			name: 'octocat',
			avatarUrl: null,
			createdAt: at,
			forges: [{ ...GITHUB, login: 'octocat', name: null, avatarUrl: null, linkedAt: at, remoteId: '7', refresh: null }]
		});

		const cookie = `recoder_session=${(await createSession('owner')).token}`;

		expect((await findAdmin())?.role).toBe('admin');
		expect(await me(cookie)).toMatchObject({ id: 'owner', role: 'admin' });
		expect((await sendAs('/api/members', 'GET', cookie)).status).toBe(200);
	});

	test('of two racing first sign-ins only one becomes the admin', async () => {
		const request = (remoteId: string, login: string) => ({
			target: GITHUB,
			user: { remoteId, login, name: null, avatarUrl: null },
			token: NO_REFRESH,
			linkTo: null
		});

		const results = await Promise.all([recordSignIn(request('7', 'octocat')), recordSignIn(request('8', 'mallory'))]);

		expect(results.map((result) => result.kind).sort()).toEqual(['created', 'rejected']);
		expect((await collection('accounts').list()).filter((account) => account.id === 'owner')).toHaveLength(1);
	});
});

describe('open sign-in', () => {
	test('a stranger’s first sign-in makes a member the admin sees in the list', async () => {
		const admin = await adminCookie();
		const cookie = await memberCookie('monalisa', 22);
		const members = (await (await sendAs('/api/members', 'GET', admin)).json()) as Member[];

		expect(await me(cookie)).toMatchObject({ role: 'member', forges: [{ login: 'monalisa' }] });

		expect(members.map((member) => [member.login, member.role])).toEqual([
			['octocat', 'admin'],
			['monalisa', 'member']
		]);

		expect(members[1]).toMatchObject({ id: members[1].key, joinedAt: expect.any(String) });
	});

	test('signing in twice keeps one member', async () => {
		const admin = await adminCookie();

		await memberCookie('hubot', 21);
		await pasteToken('hubot', 21);

		expect(await sendAs('/api/members', 'GET', admin).then((response) => response.json())).toHaveLength(2);
	});

	test('a member still gets in after renaming their forge login', async () => {
		await adminCookie();

		await memberCookie('hubot', 21);

		const { response, cookie } = await pasteToken('hubot-renamed', 21);

		expect(response.status).toBe(200);
		expect(await me(cookie)).toMatchObject({ role: 'member', forges: [{ login: 'hubot-renamed' }] });
	});

	test('a record left from an invite nobody used is not listed and does not block the sign-in', async () => {
		const admin = await adminCookie();

		await collection<StoredAccount & { invite: object }>('accounts').set({
			id: 'member:github::hubot',
			role: 'member',
			name: 'hubot',
			avatarUrl: null,
			forges: [],
			createdAt: '2026-01-01T00:00:00.000Z',
			invite: { provider: 'github', host: null, login: 'hubot', invitedAt: '2026-01-01T00:00:00.000Z' }
		});

		expect(await sendAs('/api/members', 'GET', admin).then((response) => response.json())).toHaveLength(1);
		expect((await pasteToken('hubot', 21)).response.status).toBe(200);
		expect(await sendAs('/api/members', 'GET', admin).then((response) => response.json())).toHaveLength(2);
	});
});

describe('a member’s sign-in', () => {
	test('does not change the server’s forge connection or keep the member’s token', async () => {
		await adminCookie();

		await memberCookie('hubot', 21);

		const stored = await collection<StoredAccount>('accounts').list();
		const member = stored.find((account) => account.role === 'member');

		expect(getToken('github')).toBe('gho_owner');
		expect((await findLinkedForge('github'))?.login).toBe('octocat');
		expect(JSON.stringify(member)).not.toContain('ghp_hubot');
		expect(member?.forges[0].refresh).toBeNull();
	});
});

describe('admin-only routes', () => {
	const writes: [string, string][] = [
		['PUT', '/api/settings/models'],
		['POST', '/api/settings/providers/openai/connect'],
		['POST', '/api/settings/vllm'],
		['PUT', '/api/settings/auto-review'],
		['PUT', '/api/agent/providers/openai/key'],
		['POST', '/api/agent/providers/openai/oauth'],
		['DELETE', '/api/auth/token/github'],
		['DELETE', '/api/members/owner']
	];

	test.each(writes)('a member gets 403 admin-only on %s %s', async (method, path) => {
		await adminCookie();

		const member = await memberCookie();
		const response = await sendAs(path, method, member, {});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'admin-only' });
		expect(getToken('github')).toBe('gho_owner');
	});

	test('a member may read settings and repositories but not the member list', async () => {
		await adminCookie();

		const member = await memberCookie();

		expect((await sendAs('/api/settings/models', 'GET', member)).status).toBe(200);
		expect((await sendAs('/api/agent', 'GET', member)).status).toBe(200);
		expect((await sendAs('/api/repos', 'GET', member)).status).toBe(200);
		expect((await sendAs('/api/members', 'GET', member)).status).toBe(403);
	});

	test('a member may delete a chat and a review', async () => {
		await adminCookie();

		const member = await memberCookie();
		const chat = await db.repoChats.set(newChat('repo-1', 'Question', new Date().toISOString(), 'owner'));
		const review = await db.reviews.set(testReview({ id: 'review-1' }));

		expect((await sendAs(`/api/chats/${chat.id}`, 'DELETE', member)).status).toBe(204);
		expect((await sendAs(`/api/reviews/${review.id}`, 'DELETE', member)).status).toBe(200);
	});

	test('the admin may use them', async () => {
		const admin = await adminCookie();

		expect((await sendAs('/api/members', 'GET', admin)).status).toBe(200);
		expect((await sendAs('/api/auth/token/github', 'DELETE', admin)).status).toBe(200);
	});

	test('a member pasting another forge’s token does not link it to their account', async () => {
		await adminCookie();

		const member = await memberCookie('hubot', 21);

		answerForge('api.github.com/user', userAnswer(77, 'someone-else'));

		const check = spyOn(gh, 'ghAuth').mockResolvedValue({ authenticated: true, user: 'someone-else' });

		try {
			const response = await sendAs('/api/auth/token', 'POST', member, { provider: 'github', token: 'ghp_else' });

			expect(response.status).toBe(200);
		} finally {
			check.mockRestore();
		}

		expect(await me(member)).toMatchObject({ forges: [{ login: 'hubot' }] });
	});
});

describe('removing members', () => {
	async function removeHubot(admin: string): Promise<Response> {
		const listed = (await (await sendAs('/api/members', 'GET', admin)).json()) as Member[];
		const key = listed.at(-1)?.key ?? '';

		return sendAs(`/api/members/${encodeURIComponent(key)}`, 'DELETE', admin);
	}

	test('ends the member’s existing session', async () => {
		const admin = await adminCookie();
		const member = await memberCookie();

		expect((await sendAs('/api/repos', 'GET', member)).status).toBe(200);
		expect((await removeHubot(admin)).status).toBe(204);
		expect((await sendAs('/api/repos', 'GET', member)).status).toBe(401);
		expect(await me(member)).toBeNull();
	});

	test('refuses the removed person’s next sign-in and drops them from the list', async () => {
		const admin = await adminCookie();

		await memberCookie();
		await removeHubot(admin);

		const { response, cookie } = await pasteToken('hubot', 21);
		const members = (await (await sendAs('/api/members', 'GET', admin)).json()) as Member[];

		expect(response.status).toBe(403);
		expect(cookie).toBe('');
		expect(members.map((member) => member.login)).toEqual(['octocat']);
	});

	test('answers 404 for a member who is already removed', async () => {
		const admin = await adminCookie();
		const member = await memberCookie();
		const key = (await me(member))?.id ?? '';

		expect((await removeHubot(admin)).status).toBe(204);
		expect((await sendAs(`/api/members/${encodeURIComponent(key)}`, 'DELETE', admin)).status).toBe(404);
		expect((await sendAs('/api/members/member%3Agithub%3A%3A404', 'DELETE', admin)).status).toBe(404);
	});

	test('cannot remove the admin', async () => {
		const admin = await adminCookie();
		const response = await sendAs('/api/members/owner', 'DELETE', admin);

		expect(response.status).toBe(409);
		expect((await findAdmin())?.id).toBe('owner');
		expect(await me(admin)).toMatchObject({ role: 'admin' });
	});
});
