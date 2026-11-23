import { isBotLogin, type PersonSummary } from '@recoder/shared';
import { isActiveAccount, type StoredAccount } from '../accounts/account-records';

export function personSummary(account: StoredAccount): PersonSummary {
	const { provider, host, login, name, avatarUrl } = account.forges[0];

	return { accountId: account.id, provider, host, login, name, avatarUrl };
}

export function messageableAccount(account: StoredAccount | undefined): account is StoredAccount {
	return !!account && isActiveAccount(account) && !account.forges.every(({ login }) => isBotLogin(login));
}
