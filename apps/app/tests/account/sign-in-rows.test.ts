import { describe, expect, test } from 'bun:test';
import type { AuthState } from '@recoder/shared';

import { hasNonTokenRow, signInRows } from '../../src/lib/account/sign-in-rows';

const PROVIDERS = ['github', 'gitlab'] as const;

function auth(change: Partial<AuthState>): AuthState {
	return {
		account: null,
		setup: true,
		forges: [
			{ provider: 'github', method: null },
			{ provider: 'gitlab', method: null }
		],
		connected: [],
		...change
	} as AuthState;
}

describe('the sign-in rows', () => {
	test('every forge has a row, even with nothing connected and no way to sign in', () => {
		const rows = signInRows(PROVIDERS, auth({}));

		expect(rows.map((row) => [row.provider, row.mode])).toEqual([
			['github', 'token'],
			['gitlab', 'token']
		]);
	});

	test('a forge signs in by the method the server offers', () => {
		const rows = signInRows(
			PROVIDERS,
			auth({
				forges: [
					{ provider: 'github', method: 'redirect' },
					{ provider: 'gitlab', method: 'device' }
				]
			})
		);

		expect(rows.map((row) => row.mode)).toEqual(['redirect', 'device']);
	});

	test('a connection the server has wins over the redirect and the device sign-in', () => {
		const connection = { provider: 'github', host: null, login: 'octocat' } as const;

		const rows = signInRows(
			PROVIDERS,
			auth({
				connected: [connection],
				forges: [
					{ provider: 'github', method: 'redirect' },
					{ provider: 'gitlab', method: 'device' }
				]
			})
		);

		expect(rows.map((row) => row.mode)).toEqual(['adopt', 'device']);
	});

	test('the token menu is left out when every row already opens a token form', () => {
		expect(hasNonTokenRow(signInRows(PROVIDERS, auth({})))).toBe(false);
	});

	test('the token menu stays when one row signs in another way', () => {
		const rows = signInRows(PROVIDERS, auth({ forges: [{ provider: 'gitlab', method: 'redirect' }] }));

		expect(hasNonTokenRow(rows)).toBe(true);
	});
});
