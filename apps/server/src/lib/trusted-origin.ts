import type { MiddlewareHandler } from 'hono';
import { env } from '../env';

/**
 * Recoder is a single-user server. Routes that sign in or hold credentials must
 * not be callable or observable from arbitrary websites, even though the rest
 * of the API permits CORS '*'.
 */
export const trustedOrigin: MiddlewareHandler = async (c, next) => {
	const origin = c.req.header('origin');
	const allowed = new Set([new URL(env.FRONTEND_URL).origin, new URL(c.req.url).origin]);
	if (origin && !allowed.has(origin) && !devOrigin(origin)) return c.json({ error: 'Untrusted origin' }, 403);
	c.header('Cache-Control', 'no-store');
	await next();
};

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
