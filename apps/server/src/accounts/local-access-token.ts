import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuredApiToken } from '../env';
import { postgres } from '../storage/backend';
import { serverDataDir } from '../util/data-dir';

const FILE_NAME = 'api-token';

let remembered: { dir: string; token: string } | undefined;

/**
 * The bearer token that lets a program on this machine (the eval tools) call the API once an account exists, since
 * it has no browser session. `RECODER_API_TOKEN` when set; otherwise a random token kept in the data dir with mode
 * 0600, so only whoever can read the data dir has it. Replicas that share PostgreSQL share no data dir, so there
 * the token must come from `RECODER_API_TOKEN` and without it no bearer token is accepted.
 */
export function serverAccessToken(): string | undefined {
	const configured = configuredApiToken();

	if (configured) return configured;
	if (postgres) return undefined;

	const dir = serverDataDir();

	if (remembered?.dir !== dir) remembered = { dir, token: readOrCreateTokenFile(join(dir, FILE_NAME)) };

	return remembered.token;
}

/** What a client reads to authenticate to a server on this machine: `RECODER_API_TOKEN`, else the data dir's file. */
export function clientAccessToken(): string | undefined {
	return configuredApiToken() ?? readTokenFile(join(serverDataDir(), FILE_NAME));
}

function readOrCreateTokenFile(file: string): string {
	const existing = readTokenFile(file);

	if (existing) return existing;

	const token = randomBytes(32).toString('base64url');

	try {
		writeFileSync(file, token, { mode: 0o600, flag: 'wx' });

		return token;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

		const written = readTokenFile(file);

		if (!written) throw new Error('The API token file exists but is empty.', { cause: error });

		return written;
	}
}

function readTokenFile(file: string): string | undefined {
	try {
		return readFileSync(file, 'utf8').trim() || undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

		throw error;
	}
}
