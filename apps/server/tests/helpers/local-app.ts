import { app } from '../../src/app';

/** Bun's server as a handler sees it: `requestIP` names the socket peer. */
function serverAt(address: string): { requestIP: () => { address: string; family: string; port: number } } {
	return { requestIP: () => ({ address, family: 'IPv4', port: 50_000 }) };
}

/** Sends a request to the app as if it came over the socket from `address`. */
export async function requestFrom(address: string, path: string, init?: RequestInit): Promise<Response> {
	return app.request(path, init, serverAt(address));
}

/**
 * The app as a person at the server's own machine sees it: every request comes from loopback with no proxy headers,
 * so setup is unlocked. For tests of what happens once setup is open.
 */
export const localApp = {
	request: (path: string, init?: RequestInit): Promise<Response> => requestFrom('127.0.0.1', path, init)
};

/** Sends a JSON request to the local app as the person whose session `cookie` names. */
export async function sendAs(path: string, method: string, cookie: string, body?: unknown): Promise<Response> {
	return localApp.request(path, {
		method,
		headers: { cookie, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}
