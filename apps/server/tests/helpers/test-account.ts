import type { StoredAccount } from '../../src/accounts/account-records';

export function testAccount(id: string, login: string, remoteId = id): StoredAccount {
	const at = new Date().toISOString();

	return {
		id,
		role: id === 'owner' ? 'admin' : 'member',
		name: login,
		avatarUrl: null,
		createdAt: at,
		forges: [
			{ provider: 'github', host: null, login, name: null, avatarUrl: null, linkedAt: at, remoteId, refresh: null }
		]
	};
}
