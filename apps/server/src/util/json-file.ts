import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * The object saved at `path`. A missing, unreadable or non-object file reads
 * as empty: the stores kept this way hold what Recoder learned, and losing it
 * only means learning again.
 */
export function readJsonObject(path: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** Writes through a temp file, so a crash never leaves half a file. */
export function writeJsonAtomically(path: string, value: unknown): void {
	const temp = `${path}.${process.pid}.tmp`;

	writeFileSync(temp, JSON.stringify(value));
	renameSync(temp, path);
}
