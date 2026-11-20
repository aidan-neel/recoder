import type { Context, MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { SetupChecklist } from '@recoder/shared';
import { env } from '../env';
import { isTrustedOrigin } from '../routes/trusted-origin';
import { sameSecret } from '../util/same-secret';
import { ADMIN_ACCOUNT_ID, type StoredAccount } from './account-records';
import { findAccountById, findAdmin } from './account-store';
import { isAdminOnly, SAFE_METHODS } from './admin-routes';
import { serverAccessToken } from './local-access-token';
import { redirectSignInError } from './oauth-return';
import { requestSessionToken, setSessionCookie } from './session-cookie';
import { findSession } from './sessions';
import { hasSetupAccess } from './setup-gate';

const PUBLIC_ROUTES = new Set([
	'GET /health',
	'HEAD /health',
	'GET /health/ready',
	'HEAD /health/ready',
	'GET /api/auth/me',
	'POST /api/auth/setup'
]);

const OAUTH_REDIRECT_ROUTES = new Set([
	'GET /api/auth/oauth/github/start',
	'GET /api/auth/oauth/github/callback',
	'GET /api/auth/oauth/gitlab/start',
	'GET /api/auth/oauth/gitlab/callback'
]);

const SIGN_IN_ROUTES = new Set([
	...OAUTH_REDIRECT_ROUTES,
	'POST /api/auth/token',
	'POST /api/auth/adopt',
	'POST /api/auth/device',
	'POST /api/auth/logout'
]);

/** An attempt ID is a capability. A new literal route beside the poll must not inherit its exemption. */
function isDevicePoll(c: Context): boolean {
	if (c.req.method !== 'GET' || !/^\/api\/auth\/device\/[^/]+$/.test(c.req.path)) return false;

	const routes = matchedRoutes(c).filter(({ method, path }) => method === 'GET' || !path.endsWith('*'));

	return routes.length === 1 && routes[0]?.path === '/api/auth/device/:attemptId';
}

/** Only configured webhooks may authenticate outside a Recoder session, by verifying the delivery in the handler. */
function hasWebhookAuth(route: string): boolean {
	return (
		(route === 'POST /api/webhooks/github' && !!env.GITHUB_WEBHOOK_SECRET) ||
		(route === 'POST /api/webhooks/gitlab' && !!env.GITLAB_WEBHOOK_SECRET)
	);
}

/**
 * All dynamic routes default to requiring a setup grant before claim, then a session. The machine bearer token
 * remains an alternative to a session after claim. Before claim even reads using loopback access must not expose
 * their contents to an unrelated website; after claim the session cookie and CORS protect reads.
 */
export const requireSession: MiddlewareHandler = async (c, next) => {
	const route = `${c.req.method} ${c.req.path}`;

	if (PUBLIC_ROUTES.has(route)) return next();

	const claimed = (await findAdmin()) !== undefined;

	if (!claimed) {
		if (!(await hasSetupAccess(c))) {
			c.header('Cache-Control', 'no-store');

			if (route === 'GET /api/setup') {
				return c.json({ complete: false, steps: [{ id: 'claim', done: false }] } satisfies SetupChecklist);
			}

			if (OAUTH_REDIRECT_ROUTES.has(route)) return redirectSignInError(c, 'setup-locked');

			return c.json({ error: 'Setup is locked. Enter the setup code from the server log.', kind: 'setup-locked' }, 403);
		}

		if (OAUTH_REDIRECT_ROUTES.has(route) && c.req.path.endsWith('/callback')) return next();
	} else {
		if (SIGN_IN_ROUTES.has(route) || isDevicePoll(c) || hasWebhookAuth(route) || hasBearerAccess(c)) return next();

		const account = await currentAccount(c);

		if (!account) return c.json({ error: 'Sign in to continue.', kind: 'signed-out' }, 401);

		if (account.role !== 'admin' && isAdminOnly(c.req.method, c.req.path)) {
			return c.json({ error: 'admin-only' }, 403);
		}
	}

	const origin = c.req.header('origin');

	if ((!claimed || !SAFE_METHODS.has(c.req.method)) && origin && !isTrustedOrigin(origin, c.req.url)) {
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
	const presented = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];

	if (!presented) return false;

	const expected = serverAccessToken();

	return expected !== undefined && sameSecret(expected, presented);
}

/**
 * The account a request acts for: the signed-in one, or the admin for a request with the local bearer token, and while
 * no account exists yet. It is who a review or chat the request starts is recorded as started by.
 */
export async function requestAccountId(c: Context): Promise<string> {
	if (hasBearerAccess(c)) return ADMIN_ACCOUNT_ID;

	return (await currentAccount(c))?.id ?? ADMIN_ACCOUNT_ID;
}
