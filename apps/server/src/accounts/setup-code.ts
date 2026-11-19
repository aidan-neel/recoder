import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, publicOrigin } from '../env';
import { collection, postgres } from '../storage/backend';
import { serverDataDir } from '../util/data-dir';
import { sameSecret } from '../util/same-secret';

/** Letters and digits with nothing that reads as another (no 0/O, 1/I/L), so a code can be typed from a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 8 characters of a 31-symbol alphabet is about 39.6 bits. */
const CODE_LENGTH = 8;

const FILE_NAME = 'setup-code';
const CODE_RECORD_ID = 'code';

/** How long a browser stays unlocked after entering the code. */
export const SETUP_GRANT_MS = 15 * 60_000;

/** A setup record: the code's hash, or an unlocked browser's cookie hash and expiry. Neither holds a secret in the clear. */
interface SetupRecord {
	id: string;
	hash: string;
	expiresAt: number | null;
}

/** A grant a browser holds: the token goes in the cookie, `expiresAt` bounds it. */
export interface SetupGrant {
	token: string;
	expiresAt: number;
}

const records = collection<SetupRecord>('setup');

/** The app's port under `bun run dev`: Next serves it there while the API listens on 3001 (`apps/app/package.json`). */
const DEV_APP_PORT = 5180;

/** Whether this runs as a deployed server (a container, Kubernetes or `NODE_ENV=production`) rather than a checkout. */
function deployedServer(): boolean {
	return (
		process.env.NODE_ENV === 'production' ||
		existsSync('/.dockerenv') ||
		process.env.KUBERNETES_SERVICE_HOST !== undefined
	);
}

/**
 * The address a person opens to enter the code — the web app's origin. A deployment that sets `FRONTEND_URL`
 * (Compose, Helm, the install script) is trusted, since it names the app wherever it lives. `RECODER_PUBLIC_URL`
 * is next: once one image serves the app beside the API it is that origin. A container with neither gets this
 * server's own port, which one image serves the app on; a checkout gets the dev app's port.
 */
export function setupLogUrl(): string {
	const frontend = process.env.FRONTEND_URL?.trim();

	if (frontend) return frontend;

	return publicOrigin() ?? (deployedServer() ? `http://localhost:${env.PORT}` : `http://localhost:${DEV_APP_PORT}`);
}

/**
 * Makes the one-time setup code at server start while no account exists, and retires any left over once one does.
 * Alone, the server makes a new code on every start. With shared PostgreSQL the first replica to start creates the
 * code in the shared store, atomically, and is the only one to print it; the others find it there and accept it too,
 * since the store holds only its hash and every replica compares against that. The code goes to the log in one
 * line, and to `setup-code` in the data dir (mode 0600) on the replica that made it.
 */
export async function startSetupCode(hasAccount: boolean): Promise<void> {
	if (hasAccount) return retireSetup();

	const code = makeCode();
	let created = false;

	await records.update(CODE_RECORD_ID, (current) => {
		created = !current || !postgres;

		return created ? { id: CODE_RECORD_ID, hash: hashOf(code), expiresAt: null } : current;
	});

	if (!created) return;

	writeFileSync(join(serverDataDir(), FILE_NAME), `${code}\n`, { mode: 0o600 });
	console.log(`[recoder] setup code: ${code} (enter it at ${setupLogUrl()} to claim this server)`);
}

/** Whether `candidate` is the setup code. Case, spaces and dashes are ignored; the comparison takes constant time. */
export async function isSetupCode(candidate: string): Promise<boolean> {
	const stored = await records.get(CODE_RECORD_ID);

	return stored !== undefined && sameSecret(stored.hash, hashOf(normalize(candidate)));
}

/** Unlocks one browser for fifteen minutes: the token is the cookie's value, kept only as a hash. */
export async function grantSetup(now = Date.now()): Promise<SetupGrant> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = now + SETUP_GRANT_MS;

	await records.set({ id: hashOf(token), hash: hashOf(token), expiresAt });

	return { token, expiresAt };
}

/** Whether a cookie's token names an unexpired grant. */
export async function isSetupGranted(token: string, now = Date.now()): Promise<boolean> {
	const grant = await records.get(hashOf(token));

	return grant?.expiresAt != null && grant.expiresAt > now;
}

/** Deletes the code, its file and every grant: setup is over once the account exists. */
export async function retireSetup(): Promise<void> {
	await records.clear();
	rmSync(join(serverDataDir(), FILE_NAME), { force: true });
}

/** Deletes grants that ran out, so cookies nobody used do not pile up. */
export async function pruneSetupGrants(now = Date.now()): Promise<void> {
	for (const record of await records.list()) {
		if (record.expiresAt !== null && record.expiresAt <= now) await records.delete(record.id);
	}
}

function makeCode(): string {
	return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

function normalize(candidate: string): string {
	return candidate.toUpperCase().replace(/[\s-]/g, '');
}

function hashOf(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
