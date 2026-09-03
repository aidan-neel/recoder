import { mkdirSync } from 'node:fs';

/** Directory for all server-persisted state (db, tokens, configs). */
export function serverDataDir(): string {
	const dir = process.env.RECODER_DATA_DIR ?? './data';
	mkdirSync(dir, { recursive: true });
	return dir;
}
