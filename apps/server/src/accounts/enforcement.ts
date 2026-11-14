import type { Context, MiddlewareHandler } from 'hono';
import { isTrustedOrigin } from '../routes/trusted-origin';
import { sameSecret } from '../util/same-secret';
import { ADMIN_ACCOUNT_ID, type StoredAccount } from './account-records';
import { findAccountById, findAdmin } from './account-store';
import { isAdminOnly, SAFE_METHODS } from './admin-routes';
import { serverAccessToken } from './local-access-token';
import { requestSessionToken, setSessionCookie } from './session-cookie';
import { findSession } from './sessions';

/**
 * The routes that stay open once an account exists: the ones that report or change who is signed in (pasting a token
 * is one, since it is how a person without OAuth signs back in, and it checks the token's owner itself; the OAuth redirect's start and callback are two more, since a signed-out
 * person uses them), and
 * webhooks, which carry their own signature. Everything else under `/api/auth` (status, repo lists, removing a
 * token) needs a session.
 */
const OPEN_ROUTES =
	/^\/api\/(auth\/(me|logout|token|adopt|setup|device(\/[^/]+)?|oauth\/[^/]+\/(start|callback))|webhooks\/[^/]+)$/;

/**
 * Keeps the API behind sign-in, and the admin's routes behind the admin (see `isAdminOnly`). While no account
 * exists the API is open, as it was before accounts; once one does, a request needs the session cookie, or the
 * bearer token programs on this machine use. A cookie-authenticated request that changes something must also come
 * from a trusted origin (or none, as curl does).
 */
export const requireSession: MiddlewareHandler = async (c, next) => {
	if (OPEN_ROUTES.test(c.req.path) || hasBearerAccess(c)) return next();
	if (!(await findAdmin())) return next();

	const account = await currentAccount(c);

	if (!account) return c.json({ error: 'Sign in to continue.', kind: 'signed-out' }, 401);

	if (account.role !== 'admin' && isAdminOnly(c.req.method, c.req.path)) {
		return c.json({ error: 'admin-only' }, 403);
	}

	const origin = c.req.header('origin');

	if (!SAFE_METHODS.has(c.req.method) && origin && !isTrustedOrigin(origin, c.req.url)) {
		return c.json({ error: 'Untrusted origin' }, 403);
	}

	return next();
};

/**
 * The signed-in account for this request's cookie, or undefined. A session that moved its expiry gets its cookie
 * sent again, so the browser's copy slides forward with it.
 */
export async function currentAccount(c: Context): Promise<StoredAccount | undefined> {
	const token = requestSessionToken(c);

	if (!token) return undefined;

	const session = await findSession(token);

	if (!session) return undefined;

	const account = await findAccountById(session.accountId);

	if (!account) return undefined;
	if (session.refreshed) setSessionCookie(c, { token, expiresAt: session.expiresAt });

	return account;
}

/** Whether the request carries the machine's API bearer token. */
export function hasBearerAccess(c: Context): boolean {
	const expected = serverAccessToken();
	const presented = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];

	return expected !== undefined && presented !== undefined && sameSecret(expected, presented);
}

/**
 * The account a request acts for: the signed-in one, or the admin for a request with the local bearer token, and while
 * no account exists yet. It is who a review or chat the request starts is recorded as started by.
 */
export async function requestAccountId(c: Context): Promise<string> {
	if (hasBearerAccess(c)) return ADMIN_ACCOUNT_ID;

	return (await currentAccount(c))?.id ?? ADMIN_ACCOUNT_ID;
}
