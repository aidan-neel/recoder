import { createHash, randomBytes } from 'node:crypto';
import { collection } from '../storage/backend';

export const SESSION_COOKIE = 'recoder_session';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A session lasts this long from its last refresh, and is refreshed when a request finds it a day past the last one. */
export const SESSION_TTL_MS = 30 * DAY_MS;

const SESSION_REFRESH_AFTER_MS = DAY_MS;

/** No amount of use keeps a session past this age: the person signs in again. */
const SESSION_MAX_AGE_MS = 90 * DAY_MS;

/** 32 random bytes in base64url. Anything else is refused before it reaches storage. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A session as stored. `id` is the SHA-256 of the token, so a leaked database holds nothing a browser can send. */
interface StoredSession {
	id: string;
	accountId: string;
	createdAt: number;
	expiresAt: number;
	lastRefreshedAt: number;
}

/** A session a person holds: the token goes in the cookie, `expiresAt` bounds it. */
export interface IssuedSession {
	token: string;
	expiresAt: number;
}

const sessions = collection<StoredSession>('sessions');

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Starts a session for the account with a random 256-bit token, which only this call ever holds in the clear. */
export async function createSession(accountId: string, now = Date.now()): Promise<IssuedSession> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = now + SESSION_TTL_MS;

	await sessions.set({ id: hashToken(token), accountId, createdAt: now, expiresAt, lastRefreshedAt: now });

	return { token, expiresAt };
}

/** A live session found by its token. `refreshed` means its expiry moved, so the cookie should be sent again. */
export interface FoundSession {
	accountId: string;
	expiresAt: number;
	refreshed: boolean;
}

/**
 * The session a cookie's token names, or undefined when the token is malformed, unknown or expired. Expired
 * sessions are deleted as they are found, and a live one is refreshed once a day of use.
 */
export async function findSession(token: string, now = Date.now()): Promise<FoundSession | undefined> {
	if (!TOKEN_SHAPE.test(token)) return undefined;

	const id = hashToken(token);
	const session = await sessions.get(id);

	if (!session) return undefined;

	if (session.expiresAt <= now) {
		await sessions.delete(id);

		return undefined;
	}

	if (now - session.lastRefreshedAt < SESSION_REFRESH_AFTER_MS) {
		return { accountId: session.accountId, expiresAt: session.expiresAt, refreshed: false };
	}

	const expiresAt = Math.min(now + SESSION_TTL_MS, session.createdAt + SESSION_MAX_AGE_MS);

	await sessions.update(id, (current) => (current ? { ...current, lastRefreshedAt: now, expiresAt } : undefined));

	return { accountId: session.accountId, expiresAt, refreshed: true };
}

/** Ends the session a token names. A token that names none is not an error: the person is signed out either way. */
export async function endSession(token: string): Promise<void> {
	if (TOKEN_SHAPE.test(token)) await sessions.delete(hashToken(token));
}

/** Ends every session of an account, as when a member is removed. */
export async function endSessionsOf(accountId: string): Promise<void> {
	for (const session of await sessions.list()) {
		if (session.accountId === accountId) await sessions.delete(session.id);
	}
}

/** Deletes every expired session; the refresh job calls it so sessions nobody returns to do not pile up. */
export async function pruneExpiredSessions(now = Date.now()): Promise<number> {
	let pruned = 0;

	for (const session of await sessions.list()) {
		if (session.expiresAt <= now && (await sessions.delete(session.id))) pruned += 1;
	}

	return pruned;
}
