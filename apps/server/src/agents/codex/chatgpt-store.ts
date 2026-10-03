import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LlmError } from '../../models/llm';
import { asRecord, credentialsFromTokens, credentialsSchema, type Credentials } from './chatgpt-tokens';

const storeSchema = z.object({ version: z.literal(1), credentials: credentialsSchema.nullable() });

/** The ChatGPT credentials file inside the server data directory. */
export function credentialsPath(directory: string): string {
	return join(directory, 'chatgpt-auth.json');
}

/** A JSON file's contents, or `undefined` when it does not exist. */
function readJson(file: string): unknown | undefined {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw new LlmError(0, 'Could not read saved ChatGPT credentials. Check the server data directory.');
	}
}

/** Import the old Recoder-owned Codex session once. Never reads `~/.codex` or `CODEX_HOME`. */
function migrateLegacy(directory: string, now: number): Credentials | null {
	const legacy = asRecord(readJson(join(directory, 'codex', 'auth.json')));

	if ((legacy.auth_mode && legacy.auth_mode !== 'chatgpt') || !legacy.tokens) return null;

	const credentials = credentialsFromTokens(legacy.tokens, now);

	writeCredentials(directory, credentials);

	return credentials;
}

/**
 * Saved credentials, or `null` when signed out. A saved empty store wins over
 * the legacy session, so disconnecting never brings it back.
 */
export function readCredentials(directory: string, now: number): Credentials | null {
	const raw = readJson(credentialsPath(directory));

	if (raw === undefined) return migrateLegacy(directory, now);

	const parsed = storeSchema.safeParse(raw);

	if (!parsed.success) throw new LlmError(0, 'Saved ChatGPT credentials are invalid. Disconnect and sign in again.');

	return parsed.data.credentials;
}

/** Atomically replace the credentials file, readable only by the server user. */
export function writeCredentials(directory: string, credentials: Credentials | null): void {
	const file = credentialsPath(directory);
	const temporary = `${file}.${crypto.randomUUID()}.tmp`;

	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });

		const fd = openSync(temporary, 'wx', 0o600);

		try {
			writeFileSync(fd, JSON.stringify({ version: 1, credentials }));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}

		renameSync(temporary, file);
	} catch {
		throw new LlmError(0, 'Could not save ChatGPT credentials. Check server data-directory permissions.');
	} finally {
		try {
			unlinkSync(temporary);
		} catch {}
	}
}
