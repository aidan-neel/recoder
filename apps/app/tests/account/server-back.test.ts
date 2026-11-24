import type { AuthState } from '@recoder/shared';
import { afterEach, beforeEach, expect, jest, test } from 'bun:test';

import { gateOf, useAccount } from '../../src/lib/account/account-store';
import type { AuthApi } from '../../src/lib/api/accounts';
import { request } from '../../src/lib/api/http';
import { onSessionRefused } from '../../src/lib/api/session-refused';

const realFetch = globalThis.fetch;

const signedIn: AuthState = {
	account: {
		id: 'owner',
		role: 'admin',
		name: 'Ada',
		avatarUrl: null,
		forges: [],
		createdAt: '2026-11-01T09:00:00.000Z'
	},
	setup: false,
	forges: [],
	connected: [],
	setupLocked: false
};

/** How the server behaves for the next request: down, failing, or answering who is signed in. */
let server: 'down' | 'error' | 'up' = 'up';
let meCalls = 0;
let refused = 0;
let stopRefused: () => void;

/** An auth client whose `me` goes through the app's real request path. */
function authApi(): AuthApi {
	return {
		me: () => {
			meCalls += 1;

			return request<AuthState>('/api/auth/me');
		}
	} as AuthApi;
}

/** Lets the store's promise chains settle between timer steps. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
	jest.useFakeTimers();
	server = 'up';
	meCalls = 0;
	refused = 0;
	stopRefused = onSessionRefused(() => (refused += 1));

	globalThis.fetch = (async () => {
		if (server === 'down') throw new TypeError('Failed to fetch');
		if (server === 'error') return Response.json({ error: 'Bad gateway' }, { status: 502 });

		return Response.json(signedIn);
	}) as unknown as typeof fetch;
});

afterEach(async () => {
	server = 'up';
	await request('/api/auth/me');
	await useAccount.getState().reload();
	stopRefused();
	globalThis.fetch = realFetch;
	jest.useRealTimers();
});

test('an app opened while the server is down asks again until it answers, then opens signed in', async () => {
	server = 'down';
	await useAccount.getState().ensure(authApi());

	expect(useAccount.getState().status).toBe('unavailable');

	jest.advanceTimersByTime(1000);
	await settle();
	expect(meCalls).toBe(2);
	expect(useAccount.getState().status).toBe('unavailable');

	server = 'up';
	jest.advanceTimersByTime(2000);
	await settle();

	expect(meCalls).toBe(3);
	expect(useAccount.getState().auth).toEqual(signedIn);
	expect(gateOf(useAccount.getState())).toBe('open');
	expect(refused).toBe(0);
});

test('a server that goes down or answers 502 mid-session never signs the person out, and stops being asked once it answers', async () => {
	await useAccount.getState().ensure(authApi());
	expect(useAccount.getState().auth).toEqual(signedIn);

	server = 'down';
	await request('/api/repos').catch(() => {});
	jest.advanceTimersByTime(1000);
	await settle();

	server = 'error';
	await request('/api/repos').catch(() => {});
	await useAccount.getState().reload();

	const asked = meCalls;

	jest.advanceTimersByTime(30000);
	await settle();
	expect(meCalls).toBe(asked);

	expect(useAccount.getState().auth).toEqual(signedIn);
	expect(gateOf(useAccount.getState())).toBe('open');
	expect(refused).toBe(0);
});
