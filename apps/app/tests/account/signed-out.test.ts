import { afterEach, describe, expect, test } from 'bun:test';

import { gateOf } from '../../src/lib/account/account-store';
import { request } from '../../src/lib/api/http';
import { onSessionRefused } from '../../src/lib/api/session-refused';
import { readGitlabHost } from '../../src/lib/account/gitlab-host';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('a refused request', () => {
	test('a 401 signed-out tells the app once, and another 401 does not', async () => {
		let heard = 0;
		const stop = onSessionRefused(() => (heard += 1));

		globalThis.fetch = (async () =>
			Response.json({ error: 'Sign in.', kind: 'signed-out' }, { status: 401 })) as unknown as typeof fetch;

		await request('/api/reviews').catch(() => {});

		globalThis.fetch = (async () => Response.json({ error: 'No.' }, { status: 401 })) as unknown as typeof fetch;
		await request('/api/reviews').catch(() => {});
		stop();

		expect(heard).toBe(1);
	});

	test('every request carries the session cookie', async () => {
		let seen: RequestCredentials | undefined;

		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			seen = init?.credentials;

			return Response.json({});
		}) as unknown as typeof fetch;

		await request('/api/auth/me');

		expect(seen).toBe('include');
	});
});

describe('gateOf', () => {
	const auth = { account: null, setup: true, forges: [], connected: [], setupLocked: false };

	test('waits for the first answer, then asks for sign-in when there is no account', () => {
		expect(gateOf({ status: 'loading', auth: null })).toBe('checking');
		expect(gateOf({ status: 'ready', auth })).toBe('sign-in');
	});

	test('opens the app for a server without accounts and for a signed-in person', () => {
		expect(gateOf({ status: 'unavailable', auth: null })).toBe('open');

		expect(
			gateOf({
				status: 'ready',
				auth: {
					...auth,
					account: {
						id: 'a',
						role: 'admin',
						name: 'Ada',
						avatarUrl: null,
						forges: [],
						createdAt: '2026-11-01T09:00:00.000Z'
					}
				}
			})
		).toBe('open');
	});
});

describe('readGitlabHost', () => {
	test('reduces a pasted address to its host and treats gitlab.com as no host', () => {
		expect(readGitlabHost(' https://GitLab.Example.com/group/repo ')).toEqual({ host: 'gitlab.example.com' });
		expect(readGitlabHost('gitlab.com')).toEqual({ host: undefined });
		expect(readGitlabHost('not a host')).toEqual({ error: 'Enter a host like gitlab.example.com.' });
	});
});
