import type { SignInForge } from '@recoder/shared';
import { Hono, type Context } from 'hono';
import { currentAccount } from '../accounts/enforcement';
import { ForgeHostError } from '../accounts/forge-host';
import { authorizationUrl, exchangeAuthorizationCode, ForgeOAuthError, signInMethod } from '../accounts/forge-oauth';
import { beginRedirect, claimRedirect, REDIRECT_TTL_MS, type ClaimedRedirect } from '../accounts/oauth-redirects';
import { isSetupLocked } from '../accounts/setup-gate';
import {
	clearOAuthNonceCookie,
	isHttps,
	requestOAuthNonce,
	setOAuthNonceCookie,
	setSessionCookie
} from '../accounts/session-cookie';
import { completeSignIn } from '../accounts/sign-in';
import { resolveSignInTarget } from '../accounts/sign-in-target';
import { env, publicOrigin } from '../env';

/** Why a redirect sign-in ended without a session. The app turns each into one line under its buttons. */
type SignInErrorCode = 'denied' | 'expired' | 'removed' | 'failed' | 'setup-locked';

const MAX_RETURN_PATH_LENGTH = 500;

/** Stands in for the app's origin while a return path is parsed, so a path that names another host shows. */
const PROBE_ORIGIN = 'http://return-path.invalid';

const app = new Hono();

/** Sends the browser to the forge's authorize page, with a state, a PKCE challenge and a nonce cookie of its own. */
app.get('/oauth/:provider/start', async (c) => {
	const provider = signInProvider(c.req.param('provider'));

	if (!provider) return c.json({ error: 'Unknown forge.' }, 404);
	if (await isSetupLocked(c)) return failureRedirect(c, 'setup-locked');
	if (signInMethod(provider) !== 'redirect') return failureRedirect(c, 'failed');

	try {
		const linking = (await currentAccount(c))?.role === 'admin';
		const target = await resolveSignInTarget({ provider, host: c.req.query('host') }, linking);
		const begun = await beginRedirect(target, sanitizeReturnPath(c.req.query('return')));

		setOAuthNonceCookie(c, begun.nonce, REDIRECT_TTL_MS);

		return c.redirect(
			authorizationUrl(target, {
				state: begun.state,
				codeChallenge: begun.codeChallenge,
				redirectUri: callbackUrl(c, provider)
			})
		);
	} catch (error) {
		return redirectFailure(c, error);
	}
});

/** Where the forge sends the browser back: trades the code for a token, signs the person in and lands on the app. */
app.get('/oauth/:provider/callback', async (c) => {
	const provider = signInProvider(c.req.param('provider'));

	if (!provider) return c.json({ error: 'Unknown forge.' }, 404);

	clearOAuthNonceCookie(c);

	const state = c.req.query('state');

	if (!state) return failureRedirect(c, 'expired');

	const claim = await claimRedirect(state, requestOAuthNonce(c));

	if (claim.kind === 'expired') return failureRedirect(c, 'expired');
	if (claim.kind === 'mismatch' || claim.redirect.target.provider !== provider) return failureRedirect(c, 'failed');

	const code = c.req.query('code');

	if (c.req.query('error') === 'access_denied') return failureRedirect(c, 'denied');
	if (!code) return failureRedirect(c, 'failed');

	try {
		return await finishSignIn(c, claim.redirect, code);
	} catch (error) {
		return redirectFailure(c, error);
	}
});

async function finishSignIn(c: Context, redirect: ClaimedRedirect, code: string): Promise<Response> {
	const token = await exchangeAuthorizationCode(
		redirect.target,
		{ code, codeVerifier: redirect.codeVerifier, redirectUri: callbackUrl(c, redirect.target.provider) },
		Date.now()
	);

	const account = await currentAccount(c);
	const outcome = await completeSignIn(redirect.target, token, account?.role === 'admin' ? account.id : null);

	if (outcome.kind === 'rejected') return failureRedirect(c, 'removed');
	if (outcome.signIn.session) setSessionCookie(c, outcome.signIn.session);

	return c.redirect(new URL(redirect.returnPath, env.FRONTEND_URL).href);
}

function signInProvider(value: string): SignInForge | undefined {
	return value === 'github' || value === 'gitlab' ? value : undefined;
}

/**
 * The callback address registered with the forge: this server's public origin (`RECODER_PUBLIC_URL`, else the
 * request's own host, with https when the request or its proxy says so) and the provider's callback path.
 */
function callbackUrl(c: Context, provider: SignInForge): string {
	const origin = publicOrigin() ?? `${isHttps(c) ? 'https' : 'http'}://${new URL(c.req.url).host}`;

	return `${origin}/api/auth/oauth/${provider}/callback`;
}

/** A same-app path to come back to: it starts with one slash and stays on the app's own origin, else `/`. */
function sanitizeReturnPath(value: string | undefined): string {
	if (!value || value.length > MAX_RETURN_PATH_LENGTH) return '/';
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';

	const parsed = new URL(value, PROBE_ORIGIN);

	return parsed.origin === PROBE_ORIGIN ? parsed.pathname + parsed.search : '/';
}

/** Back to the app's start with a short code, never a JSON page: the browser is mid-navigation. */
function failureRedirect(c: Context, code: SignInErrorCode): Response {
	const url = new URL('/', env.FRONTEND_URL);

	url.searchParams.set('signin-error', code);

	return c.redirect(url.href);
}

/** A thrown failure as `failed`. Only a failure that is not a typed sign-in error is logged, by its name alone. */
function redirectFailure(c: Context, error: unknown): Response {
	if (!(error instanceof ForgeHostError) && !(error instanceof ForgeOAuthError)) {
		console.error('[accounts] redirect sign-in failed', error instanceof Error ? error.name : typeof error);
	}

	return failureRedirect(c, 'failed');
}

export default app;
