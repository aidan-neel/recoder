import type { Context } from 'hono';
import { requestSetupToken } from './session-cookie';
import { isSetupGranted } from './setup-code';

/** Headers a reverse proxy adds. `tailscale serve` is one: it forwards from localhost and sets `Tailscale-User-*`. */
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-host'];
const PROXY_HEADER_PREFIX = 'tailscale-user-';

/** What Bun's server offers a handler: the socket peer of a request. Hono hands it over as `c.env`. */
interface PeerSource {
	requestIP?: (request: Request) => { address: string } | null;
}

/**
 * The address of the socket that carried the request, as Bun's `server.requestIP` reports it (`index.ts` passes the
 * server to `app.fetch`, so Hono puts it in `c.env`). Undefined when there is no server, as in a test calling
 * `app.request` without one, which counts as not loopback.
 */
export function peerAddress(c: Context): string | undefined {
	const source = c.env as PeerSource | undefined;

	return typeof source?.requestIP === 'function' ? (source.requestIP(c.req.raw)?.address ?? undefined) : undefined;
}

/**
 * Whether the request came straight from this machine: a loopback peer, and none of the headers a proxy adds. A
 * proxy on the same machine makes every client's peer loopback, so the headers are what tell a tailnet device
 * (or any other proxied client) from a person at the server.
 */
export function isLocalRequest(c: Context): boolean {
	const peer = peerAddress(c);

	if (peer === undefined || !isLoopback(peer)) return false;

	return ![...c.req.raw.headers.keys()].some(
		(name) => PROXY_HEADERS.includes(name) || name.startsWith(PROXY_HEADER_PREFIX)
	);
}

/** Whether a request is direct loopback or carries an unexpired setup grant. Only valid before claim. */
export async function hasSetupAccess(c: Context): Promise<boolean> {
	if (isLocalRequest(c)) return true;

	const token = requestSetupToken(c);

	return token !== undefined && (await isSetupGranted(token));
}

function isLoopback(address: string): boolean {
	return (
		address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
	);
}
