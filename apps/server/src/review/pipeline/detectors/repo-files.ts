import { git } from '../../../evidence/git.js';
import { compareText } from './changed-lines.js';

/** A regular file tracked at a commit, with its size in bytes. */
export interface TrackedFile {
	path: string;
	size: number;
}

/** Files larger than this are generated or data, not code worth comparing. */
export const MAX_FILE_BYTES = 100_000;

/** Regular files (no symlinks or submodules) tracked at `sha`, sorted by path. */
export async function trackedFiles(cwd: string, sha: string, signal: AbortSignal): Promise<TrackedFile[]> {
	const listed = await git(cwd, ['ls-tree', '-r', '-z', '-l', sha], signal);

	if (listed.code !== 0) return [];

	const files: TrackedFile[] = [];

	for (const record of listed.stdout.split('\0')) {
		const tab = record.indexOf('\t');

		if (tab < 0) continue;

		const [mode, type, , size] = record.slice(0, tab).split(/\s+/);

		if (type === 'blob' && (mode === '100644' || mode === '100755'))
			files.push({ path: record.slice(tab + 1), size: Number(size) || 0 });
	}

	return files.sort((a, b) => compareText(a.path, b.path));
}

/** Splits `git cat-file --batch` output into each requested path's text; missing and binary blobs are skipped. */
function parseBatch(bytes: Uint8Array, paths: string[]): Map<string, string> {
	const decoder = new TextDecoder();
	const texts = new Map<string, string>();
	let offset = 0;

	for (const path of paths) {
		const newline = bytes.indexOf(10, offset);

		if (newline < 0) break;

		const header = decoder.decode(bytes.subarray(offset, newline)).split(' ');

		offset = newline + 1;

		if (header[1] !== 'blob') continue;

		const size = Number(header[2]);
		const body = bytes.subarray(offset, offset + size);

		offset += size + 1;
		if (!body.includes(0)) texts.set(path, decoder.decode(body));
	}

	return texts;
}

/**
 * The text of each path at `sha`, read in one `git cat-file --batch`. Callers
 * pass paths from `trackedFiles`, so only regular files are read.
 */
export async function readFilesAt(
	cwd: string,
	sha: string,
	paths: string[],
	signal: AbortSignal
): Promise<Map<string, string>> {
	const wanted = paths.filter((path) => !path.includes('\n'));

	if (!wanted.length) return new Map();

	const proc = Bun.spawn(['git', 'cat-file', '--batch'], { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
	const abort = () => proc.kill();

	signal.addEventListener('abort', abort, { once: true });

	try {
		const output = new Response(proc.stdout).arrayBuffer();

		proc.stdin.write(wanted.map((path) => `${sha}:${path}\n`).join(''));
		await proc.stdin.end();

		const bytes = new Uint8Array(await output);

		await proc.exited;

		return parseBatch(bytes, wanted);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}
