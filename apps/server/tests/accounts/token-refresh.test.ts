import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { dirname } from 'node:path';
import { ADMIN_ACCOUNT_ID, accounts, openRefreshToken, toAccount } from '../../src/accounts/account-records';
import { findAdmin, findLinkedForge, recordSignIn } from '../../src/accounts/account-store';
import { refreshDueTokens, sealStoredRefreshToken } from '../../src/accounts/token-refresh';
import { getToken, setToken } from '../../src/forge/tokens';
import { sqlite } from '../../src/storage/sqlite';
import { filesHolding } from '../helpers/disk-secrets';
import { answerForge, forgeCalls, tokenAnswer, useFakeForges } from '../helpers/fake-forge-oauth';

useFakeForges();

const NOW = Date.parse('2026-11-13T10:00:00Z');
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DUE_AT = NOW + TWO_HOURS_MS - 60_000;
const GITLAB = { provider: 'gitlab', host: null } as const;
const USER = { remoteId: '99', login: 'tanuki', name: null, avatarUrl: null };
const ROTATED = { access_token: 'glpat_new', refresh_token: 'refresh-2', expires_in: 7200 };

const errors: unknown[][] = [];

/** The folder the open database lives in, which is not the current `RECODER_DATA_DIR` once other tests changed it. */
function storageDirectory(): string {
	return dirname(sqlite().filename);
}

/** The refresh token the account holds, opened. */
async function savedRefreshToken(): Promise<string | undefined> {
	const refresh = (await findLinkedForge('gitlab'))?.refresh;

	return refresh ? openRefreshToken('gitlab', refresh) : undefined;
}

/** Records a GitLab sign-in whose access token expires at `expiresAt`, and saves that token as the connection. */
async function signInWithRefresh(accessToken: string, refreshToken: string, expiresAt: number, linkTo: string | null) {
	setToken('gitlab', accessToken);

	await recordSignIn({
		target: GITLAB,
		user: USER,
		linkTo,
		token: { refreshToken, expiresAt: new Date(expiresAt).toISOString() }
	});
}

beforeEach(async () => {
	errors.length = 0;
	spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args));
	await signInWithRefresh('glpat_old', 'refresh-1', NOW + TWO_HOURS_MS, null);
});

afterEach(() => {
	spyOn(console, 'error').mockRestore();
});

describe('GitLab token refresh', () => {
	test('a token far from expiry is left alone', async () => {
		await refreshDueTokens(NOW);

		expect(forgeCalls()).toHaveLength(0);
	});

	test('a token near expiry is traded for a new pair, using the stored refresh token', async () => {
		answerForge('gitlab.com/oauth/token', tokenAnswer(ROTATED));

		await refreshDueTokens(DUE_AT);

		expect(forgeCalls()[0].form).toEqual({
			client_id: 'gitlab-client',
			refresh_token: 'refresh-1',
			grant_type: 'refresh_token'
		});

		expect(getToken('gitlab')).toBe('glpat_new');

		expect((await findLinkedForge('gitlab'))?.refresh).toEqual({
			refreshToken: expect.stringMatching(/^enc:v1:/),
			accessExpiresAt: new Date(DUE_AT + 7200 * 1000).toISOString(),
			leaseUntil: null
		});

		expect(await savedRefreshToken()).toBe('refresh-2');
	});

	test('two replicas racing for the same rotation use the refresh token once and keep a valid token', async () => {
		answerForge('gitlab.com/oauth/token', tokenAnswer(ROTATED), tokenAnswer({ error: 'invalid_grant' }, 400));

		await Promise.all([refreshDueTokens(DUE_AT), refreshDueTokens(DUE_AT)]);

		expect(forgeCalls()).toHaveLength(1);
		expect(getToken('gitlab')).toBe('glpat_new');
		expect(await savedRefreshToken()).toBe('refresh-2');
	});

	test('a refresh another replica already rotated finds fresh tokens and does not call the forge', async () => {
		answerForge('gitlab.com/oauth/token', tokenAnswer({ error: 'invalid_grant' }, 400));
		await signInWithRefresh('glpat_winner', 'refresh-winner', DUE_AT + TWO_HOURS_MS, 'owner');

		await refreshDueTokens(DUE_AT);

		expect(forgeCalls()).toHaveLength(0);
		expect(getToken('gitlab')).toBe('glpat_winner');
		expect(await savedRefreshToken()).toBe('refresh-winner');
	});

	test('a refresh token the forge no longer accepts is dropped and the saved token stays', async () => {
		answerForge('gitlab.com/oauth/token', tokenAnswer({ error: 'invalid_grant' }, 400));

		await refreshDueTokens(DUE_AT);

		expect((await findLinkedForge('gitlab'))?.refresh).toBeNull();
		expect(getToken('gitlab')).toBe('glpat_old');
	});

	test('a failed refresh is not retried until its lease runs out, and the tokens survive', async () => {
		answerForge('gitlab.com/oauth/token', new Error('connect ETIMEDOUT'), tokenAnswer(ROTATED));

		await refreshDueTokens(DUE_AT);
		await refreshDueTokens(DUE_AT + 30_000);

		expect(forgeCalls()).toHaveLength(1);
		expect(getToken('gitlab')).toBe('glpat_old');

		await refreshDueTokens(DUE_AT + 61_000);

		expect(getToken('gitlab')).toBe('glpat_new');
	});

	test('a refresh token saved before sealing is sealed at start and still renews the token', async () => {
		await accounts.update(ADMIN_ACCOUNT_ID, (current) => {
			if (!current) return current;

			return {
				...current,
				forges: current.forges.map((forge) =>
					forge.refresh ? { ...forge, refresh: { ...forge.refresh, refreshToken: 'refresh-plain' } } : forge
				)
			};
		});

		expect(filesHolding(storageDirectory(), 'refresh-plain')).not.toEqual([]);

		await sealStoredRefreshToken();

		expect((await findLinkedForge('gitlab'))?.refresh?.refreshToken).toStartWith('enc:v1:');
		expect(await savedRefreshToken()).toBe('refresh-plain');
		sqlite().run('PRAGMA wal_checkpoint(TRUNCATE)');
		expect(filesHolding(storageDirectory(), 'refresh-plain')).toEqual([]);

		answerForge('gitlab.com/oauth/token', tokenAnswer(ROTATED));
		await refreshDueTokens(DUE_AT);

		expect(getToken('gitlab')).toBe('glpat_new');
		expect(await savedRefreshToken()).toBe('refresh-2');
	});

	test('a refresh token is in no file and not in the account the API shows', async () => {
		expect(filesHolding(storageDirectory(), 'refresh-1')).toEqual([]);
		expect(JSON.stringify(toAccount((await findAdmin())!))).not.toContain('refresh');
	});

	test('no token or refresh token reaches the log', async () => {
		answerForge('gitlab.com/oauth/token', tokenAnswer({ error: 'invalid_grant', refresh_token: 'refresh-leak' }, 400));

		await refreshDueTokens(DUE_AT);

		expect(errors.length).toBeGreaterThan(0);
		expect(JSON.stringify(errors)).not.toMatch(/glpat_|refresh-/);
	});
});
