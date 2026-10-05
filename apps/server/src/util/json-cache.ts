import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serverDataDir } from './data-dir.js';

/**
 * Results that must come out the same on every run of the same input, such as
 * the distilled intent or the rule ledger, are stored on disk under a hash of
 * that input. A second review of the same PR reads them back instead of asking
 * a model again.
 */
function cachePath(namespace: string, key: string): string {
	const dir = join(serverDataDir(), 'cache', namespace);

	mkdirSync(dir, { recursive: true });

	return join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
}

/** The cached value, or null when there is none or it can't be read. */
export function readCache<T>(namespace: string, key: string): T | null {
	try {
		return JSON.parse(readFileSync(cachePath(namespace, key), 'utf8')) as T;
	} catch {
		return null;
	}
}

/** Writes through a temp file, so a crash never leaves half a cache entry. */
export function writeCache(namespace: string, key: string, value: unknown): void {
	const path = cachePath(namespace, key);
	const temp = `${path}.${process.pid}.tmp`;

	writeFileSync(temp, JSON.stringify(value));
	renameSync(temp, path);
}
