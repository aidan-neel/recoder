import { describe, expect, test } from 'bun:test';
import type { Account } from '@recoder/shared';

import { isAdmin } from '../../src/lib/account/use-is-admin';

function account(role: Account['role']): { account: Account } {
	return {
		account: { id: 'a', role, name: 'A', avatarUrl: null, forges: [], createdAt: '2026-11-01T00:00:00.000Z' }
	};
}

describe('isAdmin', () => {
	test('is true for the admin', () => {
		expect(isAdmin(account('admin'))).toBe(true);
	});

	test('is false for a signed-in member', () => {
		expect(isAdmin(account('member'))).toBe(false);
	});

	test('is true when no account exists, because such a server has no roles', () => {
		expect(isAdmin({ account: null })).toBe(true);
		expect(isAdmin(null)).toBe(true);
	});
});
