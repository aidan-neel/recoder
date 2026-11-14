import { afterEach, describe, expect, test } from 'bun:test';
import {
	createSession,
	endSession,
	findSession,
	pruneExpiredSessions,
	SESSION_TTL_MS
} from '../../src/accounts/sessions';
import { collection } from '../../src/storage/backend';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-13T10:00:00Z');
const stored = collection<{ id: string; createdAt: number }>('sessions');

afterEach(() => stored.clear());

describe('sessions', () => {
	test('a created session is found by its token and stored only as a hash', async () => {
		const session = await createSession('owner', NOW);

		expect(await findSession(session.token, NOW)).toEqual({
			accountId: 'owner',
			expiresAt: NOW + SESSION_TTL_MS,
			refreshed: false
		});

		const rows = await stored.list();

		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(session.token);
	});

	test.each(['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`])('refuses the malformed token %p', async (token) => {
		await createSession('owner', NOW);

		expect(await findSession(token, NOW)).toBeUndefined();
	});

	test('an unknown token is not a session', async () => {
		expect(await findSession('A'.repeat(43), NOW)).toBeUndefined();
	});

	test('an expired session is refused and deleted', async () => {
		const session = await createSession('owner', NOW);

		expect(await findSession(session.token, NOW + SESSION_TTL_MS)).toBeUndefined();
		expect(await stored.list()).toHaveLength(0);
	});

	test('use after a day slides the expiry forward, and the same day does not', async () => {
		const session = await createSession('owner', NOW);

		expect((await findSession(session.token, NOW + DAY_MS / 2))?.refreshed).toBe(false);

		const later = await findSession(session.token, NOW + DAY_MS + 1);

		expect(later).toEqual({ accountId: 'owner', expiresAt: NOW + DAY_MS + 1 + SESSION_TTL_MS, refreshed: true });
	});

	test('sliding never carries a session past 90 days of age', async () => {
		const session = await createSession('owner', NOW);
		let visit = NOW;

		for (let day = 0; day < 85; day++) {
			visit += DAY_MS;
			await findSession(session.token, visit);
		}

		visit += 3 * DAY_MS;

		expect((await findSession(session.token, visit))?.expiresAt).toBe(NOW + 90 * DAY_MS);
		expect(await findSession(session.token, NOW + 90 * DAY_MS)).toBeUndefined();
	});

	test('ending a session makes its token useless', async () => {
		const session = await createSession('owner', NOW);

		await endSession(session.token);
		await endSession('not a token');

		expect(await findSession(session.token, NOW)).toBeUndefined();
	});

	test('pruning deletes expired sessions and keeps live ones', async () => {
		const old = await createSession('owner', NOW - SESSION_TTL_MS - 1);
		const live = await createSession('owner', NOW);

		expect(await pruneExpiredSessions(NOW)).toBe(1);
		expect(await findSession(old.token, NOW)).toBeUndefined();
		expect(await findSession(live.token, NOW)).toBeDefined();
	});
});
