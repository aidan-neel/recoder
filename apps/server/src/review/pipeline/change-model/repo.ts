import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, readBlob } from '../../../evidence/git.js';

/** Files larger than this are generated or vendored more often than not; the model skips them. */
const MAX_FILE_BYTES = 400_000;

/** Plain code-point order, so nothing depends on the machine's locale. */
export function byCodePoint(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Tracked regular files at the checkout's index, sorted; symlinks and submodules are left out. */
export async function trackedFiles(root: string, signal: AbortSignal): Promise<string[]> {
	const listed = await git(root, ['-c', 'core.quotePath=false', 'ls-files', '-s', '-z'], signal);

	if (listed.code !== 0) throw new Error(`git ls-files failed: ${listed.stderr.slice(0, 300)}`);

	const paths: string[] = [];

	for (const record of listed.stdout.split('\0')) {
		const tab = record.indexOf('\t');

		if (tab < 0) continue;

		const mode = record.slice(0, record.indexOf(' '));

		if (mode === '100644' || mode === '100755') paths.push(record.slice(tab + 1));
	}

	return [...new Set(paths)].sort(byCodePoint);
}

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
