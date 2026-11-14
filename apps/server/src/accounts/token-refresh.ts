import { setToken } from '../forge/tokens';
import { settingsOperation } from '../storage/backend';
import { clearAllCaches } from '../util/ttl-cache';
import { hasUnsealedRefreshToken, openRefreshToken, sealRefreshToken, type StoredForge } from './account-records';
import { findLinkedForge, updateLinkedForge } from './account-store';
import { ForgeOAuthError, refreshAccessToken, type IssuedToken } from './forge-oauth';
import { pruneExpiredRedirects } from './oauth-redirects';
import { pruneExpiredSessions } from './sessions';
import { pruneSetupGrants } from './setup-code';

/** Renew a token this long before it expires, so the forge calls in flight when it would have lapsed still succeed. */
const REFRESH_MARGIN_MS = 10 * 60_000;

/** How long one replica holds a refresh token. After a crash or a failed attempt the next try comes after it. */
const LEASE_MS = 60_000;

const TICK_MS = 60_000;

/** Only GitLab's tokens expire: GitHub OAuth app tokens do not, so nothing there needs renewing. */
const PROVIDER = 'gitlab';

/** A claimed right to use one refresh token. */
interface RefreshClaim {
	refreshToken: string;
	host: string | null;
}

/**
 * Seals a refresh token saved before sealing existed. Run once at boot, before the job starts; the account update is
 * atomic, so replicas starting together cannot both rewrite it.
 */
export async function sealStoredRefreshToken(): Promise<void> {
	const forge = await findLinkedForge(PROVIDER);

	if (!forge || !hasUnsealedRefreshToken(forge)) return;

	await updateLinkedForge(PROVIDER, (current) =>
		current.refresh && hasUnsealedRefreshToken(current)
			? {
					...current,
					refresh: {
						...current.refresh,
						refreshToken: sealRefreshToken(PROVIDER, openRefreshToken(PROVIDER, current.refresh))
					}
				}
			: undefined
	);
}

/**
 * Starts the job that keeps GitLab sign-ins working: GitLab access tokens expire after about two hours, so each tick
 * renews the token that is close to expiry, and clears sessions that ran out. Every replica runs it; the lease in
 * the account record lets exactly one use a refresh token at a time.
 */
export function startTokenRefresh(): void {
	const run = () => {
		void refreshDueTokens().catch((error: unknown) =>
			console.error('[accounts] token refresh failed', error instanceof Error ? error.name : typeof error)
		);
	};

	run();

	setInterval(run, TICK_MS).unref();
}

/** One pass of the job: renew GitLab's token when due, and delete expired sessions and setup grants. */
export async function refreshDueTokens(now = Date.now()): Promise<void> {
	await refreshGitlabToken(now);
	await pruneExpiredSessions(now);
	await pruneSetupGrants(now);
	await pruneExpiredRedirects(now);
}

async function refreshGitlabToken(now: number): Promise<void> {
	const claim = await claimRefresh(now);

	if (!claim) return;

	try {
		const issued = await refreshAccessToken({ provider: PROVIDER, host: claim.host }, claim.refreshToken, now);

		await storeRefreshed(claim.refreshToken, issued);
	} catch (error) {
		await handleFailedRefresh(claim.refreshToken, error);
	}
}

/**
 * Takes the lease on the refresh token when its access token is due and no one else holds it. The lease is set inside
 * the account's atomic update, so of two replicas that both see the token due, one wins and the other skips.
 */
async function claimRefresh(now: number): Promise<RefreshClaim | undefined> {
	const forge = await findLinkedForge(PROVIDER);

	if (!forge || !isDue(forge, now)) return undefined;

	let claim: RefreshClaim | undefined;

	await updateLinkedForge(PROVIDER, (current) => {
		claim = undefined;

		if (!current.refresh || !isDue(current, now)) return undefined;

		claim = { refreshToken: openRefreshToken(PROVIDER, current.refresh), host: current.host };

		return { ...current, refresh: { ...current.refresh, leaseUntil: new Date(now + LEASE_MS).toISOString() } };
	});

	return claim;
}

function isDue(forge: StoredForge, now: number): boolean {
	if (!forge.refresh) return false;
	if (forge.refresh.leaseUntil && Date.parse(forge.refresh.leaseUntil) > now) return false;

	return Date.parse(forge.refresh.accessExpiresAt) - REFRESH_MARGIN_MS <= now;
}

/**
 * Saves a rotated pair. The new refresh token goes into the account first, while the lease still holds and the expiry
 * still reads as due, so a crash before the access token is saved loses nothing: the next pass refreshes again with
 * the new refresh token, since the old one is already dead at the forge. A result for a refresh token the account no
 * longer holds (the person signed in again meanwhile) is dropped.
 */
async function storeRefreshed(usedRefreshToken: string, issued: IssuedToken): Promise<void> {
	const { accessToken, refreshToken, expiresAt } = issued;

	if (!refreshToken || !expiresAt) {
		throw new ForgeOAuthError('The forge did not rotate the refresh token.', 'unexpected');
	}

	let isCurrent = false;

	await updateLinkedForge(PROVIDER, (current) => {
		isCurrent = holdsRefreshToken(current, usedRefreshToken);

		return isCurrent && current.refresh
			? { ...current, refresh: { ...current.refresh, refreshToken: sealRefreshToken(PROVIDER, refreshToken) } }
			: undefined;
	});

	if (!isCurrent) return;

	await settingsOperation(() => {
		setToken(PROVIDER, accessToken);
		clearAllCaches();
	});

	await updateLinkedForge(PROVIDER, (current) =>
		current.refresh && holdsRefreshToken(current, refreshToken)
			? { ...current, refresh: { ...current.refresh, accessExpiresAt: expiresAt, leaseUntil: null } }
			: undefined
	);
}

/** Whether the forge's stored refresh token is this one. */
function holdsRefreshToken(forge: StoredForge, refreshToken: string): boolean {
	return forge.refresh !== null && openRefreshToken(PROVIDER, forge.refresh) === refreshToken;
}

/**
 * A refresh that failed. A forge that says the refresh token is no good (`invalid-grant`) is final, whether another
 * replica used it up or it was revoked, so the stored one is dropped if it is still the one this attempt used and
 * the person signs in again. Any other failure keeps the lease, which is the retry delay.
 */
async function handleFailedRefresh(usedRefreshToken: string, error: unknown): Promise<void> {
	const reason = error instanceof ForgeOAuthError ? error.reason : 'error';

	console.error('[accounts] refreshing the GitLab token failed:', reason);

	if (reason !== 'invalid-grant') return;

	await updateLinkedForge(PROVIDER, (current) =>
		holdsRefreshToken(current, usedRefreshToken) ? { ...current, refresh: null } : undefined
	);
}
