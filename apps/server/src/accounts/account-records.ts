import type { Account, AccountRole, LinkedForge } from '@recoder/shared';
import { secretPurpose } from '../secrets/purposes';
import { isSealed, openStored, seal } from '../secrets/seal';
import { collection } from '../storage/backend';
import type { ForgeTarget, ForgeUser, IssuedToken } from './forge-oauth';

/**
 * The admin's record keeps its fixed id, from when Recoder had one account. Creating the admin is one atomic
 * `update` on that id, which is what lets only the first sign-in win when two replicas race, and it is why data
 * written before roles existed loads as it is.
 */
export const ADMIN_ACCOUNT_ID = 'owner';

/** The refresh half of a token, which is all an account record keeps of it. */
type TokenRefresh = Pick<IssuedToken, 'refreshToken' | 'expiresAt'>;

/** What the refresh job needs to renew a forge token before it expires. */
interface RefreshState {
	/** Sealed. Read it with {@link openRefreshToken}; a record saved before sealing existed holds it as it was. */
	refreshToken: string;
	accessExpiresAt: string;
	/** While in the future, one replica holds the right to use `refreshToken`; the others skip it. */
	leaseUntil: string | null;
}

/** A linked forge as stored: the contract's `LinkedForge` plus the forge's stable user id and refresh state. */
export interface StoredForge extends LinkedForge {
	remoteId: string;
	refresh: RefreshState | null;
}

export interface StoredAccount extends Omit<Account, 'forges'> {
	forges: StoredForge[];
	/**
	 * Set when the admin removed this member. The record stays so the same forge user is refused on a later sign-in;
	 * a removed account is never usable, see {@link isActiveAccount}.
	 */
	removedAt?: string;
}

/** A record as it may be on disk: the admin's written before roles existed has no `role`. */
type DiskAccount = Omit<StoredAccount, 'role'> & { role?: AccountRole };

const records = collection<DiskAccount>('accounts');

/** The accounts collection, read and written as {@link StoredAccount}, so a record without a role is the admin. */
export const accounts = {
	async get(id: string): Promise<StoredAccount | undefined> {
		return withRole(await records.get(id));
	},

	async list(): Promise<StoredAccount[]> {
		return (await records.list()).map((record) => ({ ...record, role: record.role ?? 'admin' }));
	},

	async delete(id: string): Promise<boolean> {
		return records.delete(id);
	},

	async update(
		id: string,
		mutate: (current: StoredAccount | undefined) => StoredAccount | undefined
	): Promise<StoredAccount | undefined> {
		return withRole(await records.update(id, (current) => mutate(withRole(current))));
	}
};

function withRole(record: DiskAccount | undefined): StoredAccount | undefined {
	return record && { ...record, role: record.role ?? 'admin' };
}

/**
 * Whether the account may sign in and be listed: not removed, and with a forge. A record with no forge is an invite
 * saved before sign-in was opened, which was never a person, so it is ignored and the first real sign-in makes a
 * member of its own.
 */
export function isActiveAccount(account: StoredAccount): boolean {
	return account.removedAt === undefined && account.forges.length > 0;
}

/** The account as the API shows it: no forge user ids and no refresh tokens. */
export function toAccount(stored: StoredAccount): Account {
	return {
		id: stored.id,
		role: stored.role,
		name: stored.name,
		avatarUrl: stored.avatarUrl,
		forges: stored.forges.map(({ provider, host, login, name, avatarUrl, linkedAt }) => ({
			provider,
			host,
			login,
			name,
			avatarUrl,
			linkedAt
		})),
		createdAt: stored.createdAt
	};
}

/** Who is signing in, how, and (when someone is signed in already) which account the forge links to. */
export interface SignInRequest {
	target: ForgeTarget;
	user: ForgeUser;
	token: TokenRefresh;
	linkTo: string | null;
}

export type SignInResult = { kind: 'created' | 'signed-in' | 'linked'; account: StoredAccount } | { kind: 'rejected' };

export function isSameIdentity(forge: StoredForge, { target, user }: SignInRequest): boolean {
	return forge.provider === target.provider && forge.host === target.host && forge.remoteId === user.remoteId;
}

export function storedForge({ target, user, token }: SignInRequest, linkedAt: string): StoredForge {
	return {
		provider: target.provider,
		host: target.host,
		login: user.login,
		name: user.name,
		avatarUrl: user.avatarUrl,
		linkedAt,
		remoteId: user.remoteId,
		refresh:
			token.refreshToken && token.expiresAt
				? {
						refreshToken: sealRefreshToken(target.provider, token.refreshToken),
						accessExpiresAt: token.expiresAt,
						leaseUntil: null
					}
				: null
	};
}

/** The form a refresh token is stored in. */
export function sealRefreshToken(provider: StoredForge['provider'], refreshToken: string): string {
	return seal(secretPurpose.forgeRefreshToken(provider), refreshToken);
}

/** The refresh token a stored forge holds, opened. */
export function openRefreshToken(provider: StoredForge['provider'], state: RefreshState): string {
	return openStored(secretPurpose.forgeRefreshToken(provider), state.refreshToken);
}

/** Whether a stored forge still holds a refresh token that was never sealed. */
export function hasUnsealedRefreshToken(forge: StoredForge): boolean {
	return forge.refresh !== null && !isSealed(forge.refresh.refreshToken);
}
