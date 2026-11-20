import type { Context } from 'hono';
import { env } from '../env';

type SignInErrorCode = 'denied' | 'expired' | 'removed' | 'failed' | 'setup-locked';

/** Stands in for the app's origin while a return path is parsed, so a path that names another host shows. */
const PROBE_ORIGIN = 'http://return-path.invalid';

/** A same-app path to come back to: it starts with one slash and stays on the app's own origin, else `/`. */
export function sanitizeReturnPath(value: string | undefined): string {
	if (!value || value.length > 500) return '/';
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';

	const parsed = new URL(value, PROBE_ORIGIN);

	return parsed.origin === PROBE_ORIGIN && !parsed.pathname.startsWith('//') ? parsed.pathname + parsed.search : '/';
}

export function frontendAddress(path: string): string {
	const destination = sanitizeReturnPath(path);

	return env.RECODER_APP_DIR ? destination : new URL(destination, env.FRONTEND_URL).href;
}

/** Return to the app with a short code rather than stranding a browser mid-navigation. */
export function redirectSignInError(c: Context, code: SignInErrorCode): Response {
	return c.redirect(frontendAddress(`/?signin-error=${code}`));
}
