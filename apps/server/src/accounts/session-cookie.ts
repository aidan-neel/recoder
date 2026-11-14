import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SetupGrant } from './setup-code';
import { SESSION_COOKIE, type IssuedSession } from './sessions';

/** The session token the request carries, or undefined. */
export function requestSessionToken(c: Context): string | undefined {
	return getCookie(c, SESSION_COOKIE);
}

const SETUP_COOKIE = 'recoder_setup';

/** The setup grant token the request carries, or undefined. */
export function requestSetupToken(c: Context): string | undefined {
	return getCookie(c, SETUP_COOKIE);
}

const OAUTH_NONCE_COOKIE = 'recoder_oauth';

/** The nonce cookie that ties a redirect sign-in's callback to the browser that started it, or undefined. */
export function requestOAuthNonce(c: Context): string | undefined {
	return getCookie(c, OAUTH_NONCE_COOKIE);
}

/** Sends the nonce cookie for the ten minutes a redirect sign-in lasts, with the session cookie's flags. */
export function setOAuthNonceCookie(c: Context, nonce: string, lifetimeMs: number): void {
	writeCookie(c, OAUTH_NONCE_COOKIE, nonce, lifetimeMs);
}

export function clearOAuthNonceCookie(c: Context): void {
	deleteCookie(c, OAUTH_NONCE_COOKIE, { path: '/', secure: isHttps(c) });
}

/** Sends the setup cookie, with the same flags as the session cookie, for the fifteen minutes the grant lasts. */
export function setSetupCookie(c: Context, grant: SetupGrant, now = Date.now()): void {
	writeCookie(c, SETUP_COOKIE, grant.token, grant.expiresAt - now);
}

/**
 * Sends the session cookie. It is HttpOnly so page scripts never see it, SameSite=Lax so another site cannot make
 * the browser send it with a cross-site request, and Secure whenever the request came over https (directly, or
 * through a proxy that says so with `X-Forwarded-Proto`).
 */
export function setSessionCookie(c: Context, session: IssuedSession, now = Date.now()): void {
	writeCookie(c, SESSION_COOKIE, session.token, session.expiresAt - now);
}

export function clearSessionCookie(c: Context): void {
	deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) });
}

function writeCookie(c: Context, name: string, value: string, lifetimeMs: number): void {
	setCookie(c, name, value, {
		httpOnly: true,
		sameSite: 'Lax',
		path: '/',
		secure: isHttps(c),
		maxAge: Math.max(0, Math.floor(lifetimeMs / 1000))
	});
}

/** Whether the request came over https, directly or through a proxy that says so with `X-Forwarded-Proto`. */
export function isHttps(c: Context): boolean {
	return (
		new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
	);
}
