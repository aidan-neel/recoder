import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { byCodePoint } from '@recoder/shared';
import { readBlob } from '../../../evidence/git.js';

/** Files larger than this are generated or vendored more often than not; the model skips them. */
export const MAX_FILE_BYTES = 400_000;

/** The shared code-point order, kept here for the change model's readers. */
export { byCodePoint };

/** A tracked file's text from the checkout, or null for a symlink, a large or binary file, or a read error. */
export async function readTracked(root: string, path: string, tracked: Set<string>): Promise<string | null> {
	if (!tracked.has(path)) return null;

	try {
		const full = join(root, path);
		const stat = await lstat(full);

		if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;

		const text = await readFile(full, 'utf8');

		return text.includes('\0') ? null : text;
	} catch {
		return null;
	}
}

/** A file's text at another commit (the merge base), or null when it isn't a readable text file there. */
export async function readAt(root: string, sha: string, path: string, signal: AbortSignal): Promise<string | null> {
	const blob = await readBlob(root, sha, path, signal);

	return blob.ok && blob.text.length <= MAX_FILE_BYTES ? blob.text : null;
}

/** Runs `run` over `items` at most `limit` at a time; results come back in input order, not completion order. */
export async function mapLimit<T, R>(
	items: T[],
	limit: number,
	run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	const worker = async () => {
		while (next < items.length) {
			const index = next++;

			results[index] = await run(items[index], index);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

	return results;
}
