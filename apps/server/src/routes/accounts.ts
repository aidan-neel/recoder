import type { AuthState, ConnectedForge, DeviceSignInState, SignInForge } from '@recoder/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { toAccount } from '../accounts/account-records';
import { findAdmin } from '../accounts/account-store';
import { adoptConnection, connectedAccountForges, connectedForges, signInWithConnection } from '../accounts/adopt';
import { deviceSignIns, type AttemptResult } from '../accounts/device-sign-ins';
import { AttemptLimit } from '../accounts/attempt-limit';
import { currentAccount } from '../accounts/enforcement';
import { ForgeHostError } from '../accounts/forge-host';
import { ForgeOAuthError, signInMethod } from '../accounts/forge-oauth';
import { clearSessionCookie, requestSessionToken, setSessionCookie, setSetupCookie } from '../accounts/session-cookie';
import { endSession } from '../accounts/sessions';
import { grantSetup, isSetupCode } from '../accounts/setup-code';
import { resolveSignInTarget } from '../accounts/sign-in-target';
import { isLocalRequest, isSetupLocked, peerAddress, refuseWhileLocked } from '../accounts/setup-gate';
import { parseBody } from './parse-body';
import { trustedOrigin } from './trusted-origin';

const SIGN_IN_FORGES: SignInForge[] = ['github', 'gitlab'];

const startSchema = z.object({
	provider: z.enum(['github', 'gitlab']),
	host: z.string().max(253).optional()
});

const setupSchema = z.object({ code: z.string().max(64) });

const adoptSchema = z.object({ provider: z.enum(['github', 'gitlab']) });

/** Setup-code tries: a few a minute for one peer, and a few more for all peers together. */
const peerAttempts = new AttemptLimit(5, 60_000);
const allAttempts = new AttemptLimit(10, 60_000);

const app = new Hono();

for (const path of ['/me', '/device', '/device/*', '/logout', '/adopt', '/setup']) app.use(path, trustedOrigin);

/** Who is signed in, whether the server still waits for its first account, and which forges can sign in. */
app.get('/me', async (c) => {
	const stored = await findAdmin();
	const account = stored ? await currentAccount(c) : undefined;

	const setupLocked = await isSetupLocked(c);

	const state: AuthState = {
		account: account ? toAccount(account) : null,
		setup: !stored,
		forges: SIGN_IN_FORGES.map((provider) => ({ provider, method: signInMethod(provider) })),
		connected: await offeredConnections(c, { hasAdmin: stored !== undefined, signedIn: account !== undefined }),
		setupLocked
	};

	return c.json(state);
});

app.post('/device', async (c) => {
	const body = await parseBody(c, startSchema);

	if (body instanceof Response) return body;

	const locked = await refuseWhileLocked(c);

	if (locked) return locked;

	const account = await currentAccount(c);
	const linker = account?.role === 'admin' ? account : undefined;

	try {
		const target = await resolveSignInTarget(body, linker !== undefined);

		return c.json(await deviceSignIns.start(target, linker?.id ?? null));
	} catch (error) {
		return signInFailure(c, error);
	}
});

app.get('/device/:attemptId', async (c) => {
	const result = await deviceSignIns.check(c.req.param('attemptId'));

	return c.json(signInState(c, result));
});

/**
 * Makes the admin account from a forge connection the server already has, and signs its owner in. Once the server
 * has an admin it only signs back in: a person on the server's own machine gets a new session for the account the
 * connection belongs to, and no account or connection changes.
 */
app.post('/adopt', async (c) => {
	const body = await parseBody(c, adoptSchema);

	if (body instanceof Response) return body;
	if (await findAdmin()) return signBackIn(c, body.provider);

	const locked = await refuseWhileLocked(c);

	if (locked) return locked;

	try {
		const adopted = await adoptConnection(body.provider);

		if (!adopted) return c.json({ error: 'This server already has an account.', kind: 'account' }, 409);

		setSessionCookie(c, adopted.session);

		return c.json({ account: toAccount(adopted.account) });
	} catch (error) {
		return signInFailure(c, error);
	}
});

/** Setup only: the one-time code from the server log unlocks claiming the server for this browser for fifteen minutes. */
app.post('/setup', async (c) => {
	const body = await parseBody(c, setupSchema);

	if (body instanceof Response) return body;
	if (await findAdmin()) return c.json({ error: 'This server already has an account.', kind: 'account' }, 409);

	const peer = peerAddress(c) ?? 'unknown';

	if (!peerAttempts.allow(peer) || !allAttempts.allow('all')) {
		c.header('Retry-After', '60');

		return c.json({ error: 'Too many tries. Wait a minute and try again.', kind: 'rate-limited' }, 429);
	}

	if (!(await isSetupCode(body.code))) return c.json({ error: 'That is not the setup code.', kind: 'setup-code' }, 403);

	setSetupCookie(c, await grantSetup());

	return c.json({ unlocked: true });
});

app.post('/logout', async (c) => {
	const token = requestSessionToken(c);

	if (token) await endSession(token);
	clearSessionCookie(c);

	return c.json({ signedOut: true });
});

/** The connections `AuthState.connected` lists: for setup or for a person signing back in at the server's own machine. */
async function offeredConnections(
	c: Context,
	{ hasAdmin, signedIn }: { hasAdmin: boolean; signedIn: boolean }
): Promise<ConnectedForge[]> {
	if (!hasAdmin) return (await isSetupLocked(c)) ? [] : connectedForges();
	if (signedIn || !isLocalRequest(c)) return [];

	return connectedAccountForges();
}

/** Signs in to the account a server connection belongs to, for a request from the server's own machine only. */
async function signBackIn(c: Context, provider: SignInForge): Promise<Response> {
	if (!isLocalRequest(c)) {
		return c.json({ error: 'Sign in with GitHub or GitLab.', kind: 'not-local' }, 403);
	}

	try {
		const signedIn = await signInWithConnection(provider);

		if (!signedIn)
			return c.json({ error: 'That connection belongs to no account on this server.', kind: 'account' }, 403);

		setSessionCookie(c, signedIn.session);

		return c.json({ account: toAccount(signedIn.account) });
	} catch (error) {
		return signInFailure(c, error);
	}
}

/** The attempt's state in the contract's shape; a finished sign-in also sends the session cookie. */
function signInState(c: Context, result: AttemptResult): DeviceSignInState {
	if (result.state !== 'signed-in') return result;

	const { account, session } = result.signIn;

	if (session) setSessionCookie(c, session);

	return { state: 'signed-in', account: toAccount(account) };
}

/** A failed start in fixed, safe words: the typed errors carry no token, code or response body. */
function signInFailure(c: Context, error: unknown): Response {
	if (error instanceof ForgeHostError) return c.json({ error: error.message, kind: 'host' }, 400);

	if (error instanceof ForgeOAuthError) {
		return c.json({ error: error.message, kind: error.reason }, failureStatus(error));
	}

	throw error;
}

function failureStatus(error: ForgeOAuthError): 400 | 429 | 502 {
	if (error.reason === 'unconfigured') return 400;
	if (error.reason === 'busy') return 429;

	return 502;
}

export default app;
