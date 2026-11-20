import type { SignInForge } from '@recoder/shared';
import { Hono, type Context } from 'hono';
import { currentAccount } from '../accounts/enforcement';
import { ForgeHostError } from '../accounts/forge-host';
import { authorizationUrl, exchangeAuthorizationCode, ForgeOAuthError, signInMethod } from '../accounts/forge-oauth';
import { beginRedirect, claimRedirect, REDIRECT_TTL_MS, type ClaimedRedirect } from '../accounts/oauth-redirects';
import { frontendAddress, redirectSignInError, sanitizeReturnPath } from '../accounts/oauth-return';
import {
	clearOAuthNonceCookie,
	isHttps,
	requestOAuthNonce,
	setOAuthNonceCookie,
	setSessionCookie
} from '../accounts/session-cookie';
import { completeSignIn } from '../accounts/sign-in';
import { resolveSignInTarget } from '../accounts/sign-in-target';
import { publicOrigin } from '../env';

const app = new Hono();

/** Sends the browser to the forge's authorize page, with a state, a PKCE challenge and a nonce cookie of its own. */
app.get('/oauth/:provider/start', async (c) => {
	const provider = signInProvider(c.req.param('provider'));

	if (!provider) return c.json({ error: 'Unknown forge.' }, 404);
	if (signInMethod(provider) !== 'redirect') return redirectSignInError(c, 'failed');

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

	if (!state) return redirectSignInError(c, 'expired');

	const claim = await claimRedirect(state, requestOAuthNonce(c));

	if (claim.kind === 'expired') return redirectSignInError(c, 'expired');
	if (claim.kind === 'mismatch' || claim.redirect.target.provider !== provider) return redirectSignInError(c, 'failed');

	const code = c.req.query('code');

	if (c.req.query('error') === 'access_denied') return redirectSignInError(c, 'denied');
	if (!code) return redirectSignInError(c, 'failed');

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

	if (outcome.kind === 'rejected') return redirectSignInError(c, 'removed');
	if (outcome.signIn.session) setSessionCookie(c, outcome.signIn.session);

	return c.redirect(frontendAddress(redirect.returnPath));
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

/** A thrown failure as `failed`. Only a failure that is not a typed sign-in error is logged, by its name alone. */
function redirectFailure(c: Context, error: unknown): Response {
	if (!(error instanceof ForgeHostError) && !(error instanceof ForgeOAuthError)) {
		console.error('[accounts] redirect sign-in failed', error instanceof Error ? error.name : typeof error);
	}

	return redirectSignInError(c, 'failed');
}

export default app;
