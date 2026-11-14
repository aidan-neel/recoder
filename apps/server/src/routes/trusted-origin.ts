import type { MiddlewareHandler } from 'hono';
import { env } from '../env';

/**
 * Recoder is a single-user server. Routes that sign in or hold credentials must
 * not be callable or observable from arbitrary websites, even though the rest
 * of the API permits CORS '*'.
 */
export const trustedOrigin: MiddlewareHandler = async (c, next) => {
	const origin = c.req.header('origin');

	if (origin && !isTrustedOrigin(origin, c.req.url)) return c.json({ error: 'Untrusted origin' }, 403);
	c.header('Cache-Control', 'no-store');
	await next();
};

/**
 * Whether a page at `origin` may use credentials with this server: the configured `FRONTEND_URL`, the server's own
 * origin, and in development any loopback origin.
 */
export function isTrustedOrigin(origin: string, requestUrl: string): boolean {
	const allowed = new Set([new URL(env.FRONTEND_URL).origin, new URL(requestUrl).origin]);

	return allowed.has(origin) || devOrigin(origin);
}

/** Vite moves to the next free port, so dev trusts any loopback origin. */
function devOrigin(origin: string): boolean {
	if (process.env.NODE_ENV === 'production') return false;

	try {
		const { protocol, hostname } = new URL(origin);

		return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
	} catch {
		return false;
	}
}
