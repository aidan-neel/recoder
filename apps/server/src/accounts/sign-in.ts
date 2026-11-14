import type { StoredAccount } from './account-records';
import { recordSignIn } from './account-store';
import { connectForge } from './forge-connection';
import { fetchForgeUser, type ForgeTarget, type IssuedToken } from './forge-oauth';
import { createSession, type IssuedSession } from './sessions';

/** A finished sign-in: the account, and the session when this sign-in started one (linking a forge does not). */
export interface CompletedSignIn {
	account: StoredAccount;
	session: IssuedSession | null;
}

export type SignInOutcome = { kind: 'completed'; signIn: CompletedSignIn } | { kind: 'rejected' };

/**
 * The step both ways in share: a forge token (from the device flow or a pasted one) becomes an account sign-in.
 * It reads who the token belongs to, records the sign-in, and only when that is accepted from the admin makes the
 * token the forge connection: a rejected stranger's token is never saved, and a member's is not either, since the
 * server reads pull requests with the admin's. `linkTo` is the signed-in account, or null.
 */
export async function completeSignIn(
	target: ForgeTarget,
	token: IssuedToken,
	linkTo: string | null
): Promise<SignInOutcome> {
	const user = await fetchForgeUser(target, token.accessToken);
	const result = await recordSignIn({ target, user, token, linkTo });

	if (result.kind === 'rejected') return { kind: 'rejected' };

	if (result.account.role === 'admin') connectForge(target, token.accessToken);

	return {
		kind: 'completed',
		signIn: {
			account: result.account,
			session: result.kind === 'linked' ? null : await createSession(result.account.id)
		}
	};
}
