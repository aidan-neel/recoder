import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Directory for all server-persisted state (db, tokens, configs).
 * Defaults to ~/.recoder/data so state survives regardless of the working
 * directory the server was launched from (./data would move with the CWD
 * and take tokens/configs with it). Override with RECODER_DATA_DIR.
 */
export function serverDataDir(): string {
	const dir = process.env.RECODER_DATA_DIR ?? join(homedir(), '.recoder', 'data');
	mkdirSync(dir, { recursive: true });
	return dir;
}
