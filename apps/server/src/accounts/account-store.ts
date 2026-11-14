import type { SignInForge } from '@recoder/shared';
import type { ForgeTarget } from './forge-oauth';
import {
	ADMIN_ACCOUNT_ID,
	accounts,
	isActiveAccount,
	isSameIdentity,
	storedForge,
	type SignInRequest,
	type SignInResult,
	type StoredAccount,
	type StoredForge
} from './account-records';
import { recordMemberSignIn } from './members';
import { retireSetup } from './setup-code';

/** The admin: the account the server was set up with. Undefined while the server waits for its first sign-in. */
export async function findAdmin(): Promise<StoredAccount | undefined> {
	return accounts.get(ADMIN_ACCOUNT_ID);
}

/** The account a session names, or undefined when it is gone or the member was removed. */
export async function findAccountById(id: string): Promise<StoredAccount | undefined> {
	const account = await accounts.get(id);

	return account && isActiveAccount(account) ? account : undefined;
}

/**
 * The account that has signed in with this forge login before, matched case-insensitively: the admin, or a member
 * who has not been removed.
 */
export async function findAccountByLogin(target: ForgeTarget, login: string): Promise<StoredAccount | undefined> {
	const wanted = login.toLowerCase();

	return (await activeAccounts()).find((account) =>
		account.forges.some(
			(forge) =>
				forge.provider === target.provider && forge.host === target.host && forge.login.toLowerCase() === wanted
		)
	);
}

/** The account whose forge is this user (matched by the forge's user id), or undefined when there is none or it was removed. */
export async function findAccountByIdentity(target: ForgeTarget, remoteId: string): Promise<StoredAccount | undefined> {
	return (await activeAccounts()).find((account) =>
		account.forges.some(
			(forge) => forge.provider === target.provider && forge.host === target.host && forge.remoteId === remoteId
		)
	);
}

/**
 * Records a forge sign-in. With nobody signed in it creates the admin, or signs in to the one whose linked forge is
 * this person. Any other person becomes a member, unless the admin removed them; a second forge account cannot
 * become the admin. Signed in as the admin, it links the forge, replacing that provider's earlier link.
 */
export async function recordSignIn(request: SignInRequest): Promise<SignInResult> {
	const admin = await findAdmin();

	if (admin && request.linkTo === null && !admin.forges.some((forge) => isSameIdentity(forge, request))) {
		return recordMemberSignIn(request);
	}

	const decided: { result: SignInResult } = { result: { kind: 'rejected' } };

	await accounts.update(ADMIN_ACCOUNT_ID, (current) => {
		decided.result = applyAdminSignIn(current, request);

		return decided.result.kind === 'rejected' ? current : decided.result.account;
	});

	if (decided.result.kind === 'created') await retireSetup();

	return decided.result;
}

/**
 * Creates the admin from this forge identity, only when none exists: the atomic update lets one of two racing
 * callers create it and the other see it. Returns undefined when an admin already existed.
 */
export async function createAdminIfNone(request: SignInRequest): Promise<StoredAccount | undefined> {
	let created: StoredAccount | undefined;

	await accounts.update(ADMIN_ACCOUNT_ID, (current) => {
		created = current ? undefined : createAdmin(request);

		return current ?? created;
	});

	if (created) await retireSetup();

	return created;
}

/** The admin's linked forge for a provider, or undefined. The server's forge connection is the admin's. */
export async function findLinkedForge(provider: SignInForge): Promise<StoredForge | undefined> {
	return (await findAdmin())?.forges.find((forge) => forge.provider === provider);
}

/**
 * Applies `change` to one of the admin's linked forges inside the account's atomic update. `change` returns the
 * forge's new state, or undefined to leave it as it is.
 */
export async function updateLinkedForge(
	provider: SignInForge,
	change: (forge: StoredForge) => StoredForge | undefined
): Promise<void> {
	await accounts.update(ADMIN_ACCOUNT_ID, (current) => {
		if (!current) return current;

		return {
			...current,
			forges: current.forges.map((forge) => (forge.provider === provider ? (change(forge) ?? forge) : forge))
		};
	});
}

async function activeAccounts(): Promise<StoredAccount[]> {
	return (await accounts.list()).filter(isActiveAccount);
}

function applyAdminSignIn(current: StoredAccount | undefined, request: SignInRequest): SignInResult {
	if (!current) {
		if (request.linkTo) return { kind: 'rejected' };

		return { kind: 'created', account: createAdmin(request) };
	}

	if (request.linkTo === current.id) return { kind: 'linked', account: withForge(current, request) };

	if (request.linkTo === null && current.forges.some((forge) => isSameIdentity(forge, request))) {
		return { kind: 'signed-in', account: withForge(current, request) };
	}

	return { kind: 'rejected' };
}

function createAdmin(request: SignInRequest): StoredAccount {
	const now = new Date().toISOString();
	const forge = storedForge(request, now);

	return {
		id: ADMIN_ACCOUNT_ID,
		role: 'admin',
		name: forge.name ?? forge.login,
		avatarUrl: forge.avatarUrl,
		forges: [forge],
		createdAt: now
	};
}

/** The account with this sign-in's forge in place of any earlier link to the same provider. */
function withForge(account: StoredAccount, request: SignInRequest): StoredAccount {
	const earlier = account.forges.find((forge) => isSameIdentity(forge, request));
	const forge = storedForge(request, earlier?.linkedAt ?? new Date().toISOString());

	return {
		...account,
		forges: [...account.forges.filter((other) => other.provider !== request.target.provider), forge]
	};
}
