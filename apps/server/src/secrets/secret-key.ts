import { randomBytes } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { configuredSecretKey, env } from '../env';
import { SECRET_KEY_BYTES, decodeSecretKey } from './key-format';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

/** Where the key came from: `RECODER_SECRET_KEY`, or a key file kept outside the data folder. */
export type SecretKeySource = { kind: 'env' } | { kind: 'file'; path: string };

export interface SecretKey {
	key: Buffer;
	source: SecretKeySource;
}

/** The key could not be found, made or read. The message names the variable or file, never the key. */
export class SecretKeyError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'SecretKeyError';
	}
}

/** What `loadSecretKey` decides from: the environment's key, whether replicas share a database, and the key file. */
export interface SecretKeyLocation {
	envKey: Buffer | undefined;
	isShared: boolean;
	keyFile: string;
}

let cachedFileKey: { path: string; key: Buffer } | undefined;

/**
 * The key that seals stored credentials. `RECODER_SECRET_KEY` wins; it is required when replicas share PostgreSQL,
 * since each must open what another sealed. Otherwise the key lives in a file outside the data folder, made on first
 * use. Read per call, so a test can switch the environment.
 */
export function secretKey(): SecretKey {
	return loadSecretKey({
		envKey: configuredSecretKey(),
		isShared: env.RECODER_DATABASE_URL !== undefined,
		keyFile: secretKeyFile()
	});
}

export function loadSecretKey({ envKey, isShared, keyFile }: SecretKeyLocation): SecretKey {
	if (envKey) return { key: envKey, source: { kind: 'env' } };

	if (isShared) {
		throw new SecretKeyError(
			'RECODER_SECRET_KEY is required when RECODER_DATABASE_URL is set, so every replica opens the same credentials. ' +
				'Generate one with `openssl rand -base64 32`.'
		);
	}

	if (cachedFileKey?.path !== keyFile)
		cachedFileKey = { path: keyFile, key: readKeyFile(keyFile) ?? createKeyFile(keyFile) };

	return { key: cachedFileKey.key, source: { kind: 'file', path: keyFile } };
}

/** `$XDG_CONFIG_HOME/recoder/secret.key`, else `~/.config/recoder/secret.key`. */
export function secretKeyFile(): string {
	const configured = process.env.XDG_CONFIG_HOME;
	const configHome = configured && configured.startsWith('/') ? configured : join(homedir(), '.config');

	return join(configHome, 'recoder', 'secret.key');
}

/** One line for the start-up log: where the key comes from. */
export function describeSecretKeySource(source: SecretKeySource): string {
	return source.kind === 'env' ? 'RECODER_SECRET_KEY' : `key file ${source.path}`;
}

function readKeyFile(file: string): Buffer | undefined {
	let text: string;

	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

		throw new SecretKeyError(`Could not read the secret key file ${file}.`, { cause: error });
	}

	const key = decodeSecretKey(text);

	if (!key) throw new SecretKeyError(`The secret key file ${file} must hold ${SECRET_KEY_BYTES} bytes as base64.`);

	return key;
}

/**
 * Writes a new key to a private temporary file and links it into place, so a reader never sees a half-written key
 * and of two processes starting together one key wins. The loser reads the winner's.
 */
function createKeyFile(file: string): Buffer {
	const key = randomBytes(SECRET_KEY_BYTES);
	const temporary = `${file}.${crypto.randomUUID()}.tmp`;

	try {
		mkdirSync(dirname(file), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		writeFileSync(temporary, `${key.toString('base64')}\n`, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
		chmodSync(temporary, PRIVATE_FILE_MODE);
		linkSync(temporary, file);

		return key;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			const winner = readKeyFile(file);

			if (winner) return winner;
		}

		throw new SecretKeyError(`Could not create the secret key file ${file}.`, { cause: error });
	} finally {
		rmSync(temporary, { force: true });
	}
}
