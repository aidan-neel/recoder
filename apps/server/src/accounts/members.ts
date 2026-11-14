import type { Member } from '@recoder/shared';
import {
	ADMIN_ACCOUNT_ID,
	accounts,
	isActiveAccount,
	isSameIdentity,
	storedForge,
	type SignInRequest,
	type SignInResult,
	type StoredAccount
} from './account-records';
import { getGitlabHost } from '../forge/gitlab-host';
import type { ForgeTarget } from './forge-oauth';
import { endSessionsOf } from './sessions';

const MEMBER_ID_PREFIX = 'member:';

/** Why a removal was refused; the route answers with `status`. */
export class MemberError extends Error {
	constructor(
		message: string,
		readonly status: 404 | 409
	) {
		super(message);
		this.name = 'MemberError';
	}
}

/** Everyone who may sign in: the admin first, then the members in the order they joined. */
export async function listMembers(): Promise<Member[]> {
	const records = (await accounts.list()).filter(isActiveAccount);
	const admin = records.filter((record) => record.id === ADMIN_ACCOUNT_ID);
	const others = records.filter((record) => record.id !== ADMIN_ACCOUNT_ID);

	return [...admin, ...others].map(toMember);
}

/**
 * Removes a member and ends their sessions. The record stays, marked removed, so that forge user is refused when
 * they sign in again. The admin cannot be removed.
 */
export async function removeMember(key: string): Promise<void> {
	if (key === ADMIN_ACCOUNT_ID) throw new MemberError('The admin cannot be removed.', 409);
	if (!key.startsWith(MEMBER_ID_PREFIX)) throw new MemberError('Member not found.', 404);

	let removed = false;

	await accounts.update(key, (current) => {
		if (!current || !isActiveAccount(current)) return current;

		removed = true;

		return { ...current, removedAt: new Date().toISOString() };
	});

	if (!removed) throw new MemberError('Member not found.', 404);

	await endSessionsOf(key);
}

/**
 * Signs in a person who is not the admin. The first sign-in makes the member's account, keeping no forge token: the
 * account needs only who the person is, and the server's forge connection stays the admin's. Later sign-ins find
 * the account by the forge's user id, so a renamed login still gets in. A removed member is rejected.
 */
export async function recordMemberSignIn(request: SignInRequest): Promise<SignInResult> {
	if (request.linkTo !== null) return { kind: 'rejected' };

	const id = await memberRecordId(request);
	const decided: { result: SignInResult } = { result: { kind: 'rejected' } };

	await accounts.update(id, (current) => {
		decided.result = applyMemberSignIn(current, request);

		return decided.result.kind === 'rejected' ? current : decided.result.account;
	});

	return decided.result;
}

/**
 * The GitLab hosts a person who is not signed in may start a sign-in on: the server's own, so a stranger can join
 * it, and the hosts the existing accounts signed in on.
 */
export async function knownForgeHosts(): Promise<(string | null)[]> {
	const hosts = (await accounts.list()).flatMap((account) => account.forges.map((forge) => forge.host));

	return [getGitlabHost(), ...hosts];
}

/** The record this sign-in belongs to: the one already made for this forge user, removed or not, else a new id. */
async function memberRecordId(request: SignInRequest): Promise<string> {
	const existing = (await accounts.list()).find(
		(account) => account.role === 'member' && account.forges.some((forge) => isSameIdentity(forge, request))
	);

	return existing?.id ?? newMemberId(request.target, request.user.remoteId);
}

function newMemberId(target: ForgeTarget, remoteId: string): string {
	return `${MEMBER_ID_PREFIX}${target.provider}:${target.host ?? ''}:${remoteId}`;
}

function applyMemberSignIn(current: StoredAccount | undefined, request: SignInRequest): SignInResult {
	if (current && (current.role !== 'member' || current.removedAt !== undefined)) return { kind: 'rejected' };

	const now = new Date().toISOString();

	const forge = storedForge(
		{ ...request, token: { refreshToken: null, expiresAt: null } },
		current?.forges[0]?.linkedAt ?? now
	);

	return {
		kind: current ? 'signed-in' : 'created',
		account: {
			id: current?.id ?? newMemberId(request.target, request.user.remoteId),
			role: 'member',
			name: forge.name ?? forge.login,
			avatarUrl: forge.avatarUrl,
			forges: [forge],
			createdAt: current?.createdAt ?? now
		}
	};
}

function toMember(account: StoredAccount): Member {
	const [forge] = account.forges;

	return {
		key: account.id,
		id: account.id,
		provider: forge.provider,
		host: forge.host,
		login: forge.login,
		name: forge.name,
		avatarUrl: forge.avatarUrl,
		role: account.role,
		joinedAt: account.createdAt
	};
}
