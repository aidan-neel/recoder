import { createHash, randomBytes } from 'node:crypto';
import { secretPurpose } from '../secrets/purposes';
import { openStored, seal } from '../secrets/seal';
import { collection } from '../storage/backend';
import { sameSecret } from '../util/same-secret';
import { ForgeOAuthError, type ForgeTarget } from './forge-oauth';

/** A person has this long between the forge's authorize page and the callback. */
export const REDIRECT_TTL_MS = 10 * 60_000;

/** How many redirects may wait at once; the start route is open, so it cannot fill the store without end. */
const MAX_OPEN_REDIRECTS = 500;

/** A redirect sign-in as stored. `id` is the SHA-256 of `state`, and `nonceHash` binds it to one browser's cookie. */
interface StoredRedirect {
	id: string;
	nonceHash: string;
	target: ForgeTarget;
	returnPath: string;
	/** Sealed. */
	codeVerifier: string;
	expiresAt: number;
}

/** What `beginRedirect` hands the start route: `nonce` goes in a cookie, the rest in the authorize URL. */
export interface BegunRedirect {
	state: string;
	nonce: string;
	codeChallenge: string;
}

/** A redirect the callback claimed: where it was going, and the verifier its code is traded with. */
export interface ClaimedRedirect {
	target: ForgeTarget;
	returnPath: string;
	codeVerifier: string;
}

/** `expired` is a state that is unknown, used or too old; `mismatch` is one this browser did not start. */
export type RedirectClaim = { kind: 'claimed'; redirect: ClaimedRedirect } | { kind: 'expired' } | { kind: 'mismatch' };

const redirects = collection<StoredRedirect>('oauth_redirects');

/** Stores a new redirect sign-in with a random state, nonce and PKCE verifier (S256), good for ten minutes. */
export async function beginRedirect(target: ForgeTarget, returnPath: string, now = Date.now()): Promise<BegunRedirect> {
	await pruneExpiredRedirects(now);

	if ((await redirects.list()).length >= MAX_OPEN_REDIRECTS) {
		throw new ForgeOAuthError('Too many sign-ins are open. Wait a moment and try again.', 'busy');
	}

	const state = randomToken();
	const nonce = randomToken();
	const codeVerifier = randomToken();

	const id = digest(state);

	await redirects.set({
		id,
		nonceHash: digest(nonce),
		target,
		returnPath,
		codeVerifier: seal(secretPurpose.oauthCodeVerifier(id), codeVerifier),
		expiresAt: now + REDIRECT_TTL_MS
	});

	return { state, nonce, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') };
}

/**
 * Uses a state up, once: the record is deleted inside the atomic update that reads it, so a replay, or a second
 * replica racing the first, finds nothing. A state is spent even when its nonce does not match.
 */
export async function claimRedirect(
	state: string,
	nonce: string | undefined,
	now = Date.now()
): Promise<RedirectClaim> {
	let stored: StoredRedirect | undefined;

	await redirects.update(digest(state), (current) => {
		stored = current;

		return undefined;
	});

	if (!stored || stored.expiresAt <= now) return { kind: 'expired' };
	if (nonce === undefined || !sameSecret(stored.nonceHash, digest(nonce))) return { kind: 'mismatch' };

	return {
		kind: 'claimed',
		redirect: {
			target: stored.target,
			returnPath: stored.returnPath,
			codeVerifier: openStored(secretPurpose.oauthCodeVerifier(stored.id), stored.codeVerifier)
		}
	};
}

/** Deletes redirects that ran out, so sign-ins nobody finished do not pile up. */
export async function pruneExpiredRedirects(now = Date.now()): Promise<void> {
	for (const redirect of await redirects.list()) {
		if (redirect.expiresAt <= now) await redirects.delete(redirect.id);
	}
}

function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
