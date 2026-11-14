import type { ConnectedForge, SignInForge } from '@recoder/shared';
import { extractJson, gh, GhError } from '../forge/gh';
import { forgeAuthStatus } from '../forge/auth-status';
import { getGitlabHost } from '../forge/gitlab-host';
import { glabApi } from '../forge/glab';
import { getToken, tokenEnv } from '../forge/tokens';
import type { StoredAccount } from './account-records';
import { createAdminIfNone, findAccountByIdentity, findAccountByLogin } from './account-store';
import { fetchForgeUser, ForgeOAuthError, parseForgeUser, type ForgeTarget, type ForgeUser } from './forge-oauth';
import { createSession, type IssuedSession } from './sessions';

/** An adopted connection: the new account and the session that signs its owner in. */
export interface AdoptedAccount {
	account: StoredAccount;
	session: IssuedSession;
}

/**
 * The forge connections the server already has, from the cached forge status (a saved token, or a signed-in `gh` or
 * `glab`), so an existing install can make its account from one. Only meaningful during setup.
 */
export async function connectedForges(): Promise<ConnectedForge[]> {
	const { github, gitlab } = await forgeAuthStatus();
	const connected: ConnectedForge[] = [];

	if (github.authenticated && github.user) connected.push({ provider: 'github', host: null, login: github.user });

	if (gitlab.authenticated && gitlab.user) {
		connected.push({ provider: 'gitlab', host: getGitlabHost(), login: gitlab.user });
	}

	return connected;
}

/**
 * The connections the server has whose user already has an account (the admin, or a member who has joined), for a
 * person on the server's own machine to sign back in with. Matched by login, which is all the cached status holds.
 */
export async function connectedAccountForges(): Promise<ConnectedForge[]> {
	const known: ConnectedForge[] = [];

	for (const forge of await connectedForges()) {
		if (await findAccountByLogin({ provider: forge.provider, host: forge.host }, forge.login)) known.push(forge);
	}

	return known;
}

/**
 * Signs in to the account the server's connection belongs to, with a new session. It makes no account and does not
 * touch the connection. Returns undefined when the connection's user has no account.
 */
export async function signInWithConnection(provider: SignInForge): Promise<AdoptedAccount | undefined> {
	const target = connectionTarget(provider);
	const user = await connectionUser(target);
	const account = await findAccountByIdentity(target, user.remoteId);

	return account && { account, session: await createSession(account.id) };
}

/**
 * Makes the admin account from a connection the server already has. The identity comes from the forge's user
 * endpoint, called with the connection's own credentials. Returns undefined when an account exists, which the
 * atomic create decides, so only one of two racing callers gets one. The connection itself is already in place.
 */
export async function adoptConnection(provider: SignInForge): Promise<AdoptedAccount | undefined> {
	const target = connectionTarget(provider);
	const user = await connectionUser(target);

	const account = await createAdminIfNone({
		target,
		user,
		token: { refreshToken: null, expiresAt: null },
		linkTo: null
	});

	if (!account) return undefined;

	return { account, session: await createSession(account.id) };
}

function connectionTarget(provider: SignInForge): ForgeTarget {
	return { provider, host: provider === 'gitlab' ? getGitlabHost() : null };
}

/** Who the connection belongs to: the saved token's owner, else the signed-in CLI's. */
async function connectionUser(target: ForgeTarget): Promise<ForgeUser> {
	const token = getToken(target.provider);

	if (token) return fetchForgeUser(target, token);

	try {
		return parseForgeUser(await cliUser(target));
	} catch (error) {
		if (!(error instanceof GhError)) throw error;

		if (error.kind === 'auth') {
			throw new ForgeOAuthError(`This server has no ${target.provider} connection.`, 'unconfigured');
		}

		throw new ForgeOAuthError(`Could not read the ${target.provider} connection.`, 'unreachable');
	}
}

async function cliUser(target: ForgeTarget): Promise<unknown> {
	if (target.provider === 'gitlab') return glabApi('user', tokenEnv('gitlab'));

	return extractJson(await gh(['api', 'user'], tokenEnv('github')));
}
