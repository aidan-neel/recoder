import { byCodePoint, REPO_FILE_TEXT_BYTES, type RepoTreeEntry, type RepoTreeEntryKind } from '@recoder/shared';
import { git } from '../evidence/git';
import { RepoFilesError, timedOut } from './errors';

/** Where git's own binary check stops looking for a NUL. */
const BINARY_SNIFF_BYTES = 8000;

/** A symlink target longer than this is absurd; the blob is read to here only. */
const SYMLINK_TARGET_BYTES = 4096;

/** What `git cat-file` produces for one blob, cut at the caller's cap. */
interface BlobRead {
	bytes: Uint8Array;
	/** True when the blob held more than the cap. */
	truncated: boolean;
}

/** One `git ls-tree -lz -l` record: `<mode> <type> <sha> <size|->\t<path>`, NUL-separated. */
interface LsRecord {
	mode: string;
	type: string;
	sha: string;
	/** Blob size in bytes; null for trees and submodules, which print `-`. */
	size: number | null;
	path: string;
}

/** The one level of `dir` at `commit`, directories first then by name. `dir` is '' for the root. */
export async function listDirectory(
	root: string,
	commit: string,
	dir: string,
	signal: AbortSignal
): Promise<RepoTreeEntry[]> {
	const records = dir === '' ? await lsTree(root, [commit], signal) : await lsDirRecords(root, commit, dir, signal);

	const entries = await Promise.all(records.map((record) => toTreeEntry(root, record, signal)));

	return entries.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || byCodePoint(a.name, b.name));
}

/** The blob named by `path` at `commit`, with symlink, directory and submodule refused. */
export async function readRepoFileAt(
	root: string,
	commit: string,
	path: string,
	signal: AbortSignal
): Promise<{ sha: string; size: number; binary: boolean; truncated: boolean; text?: string }> {
	const [entry] = await lsTree(root, [commit, '--', path], signal);

	if (!entry) throw new RepoFilesError(`'${path}' was not found at this ref.`, 404);
	if (entry.type === 'tree') throw new RepoFilesError(`'${path}' is a directory.`, 400);

	if (entry.mode === '120000') {
		throw new RepoFilesError(`'${path}' is a symbolic link and is not followed.`, 400);
	}

	if (entry.type === 'commit' || entry.mode === '160000') {
		throw new RepoFilesError(`'${path}' is a submodule and has no file text.`, 400);
	}

	const size = entry.size ?? (await blobSize(root, entry.sha, signal));
	const read = await readBlob(root, entry.sha, REPO_FILE_TEXT_BYTES, signal);
	const binary = isBinary(read.bytes);

	return {
		sha: entry.sha,
		size,
		binary,
		truncated: !binary && read.truncated,
		...(binary ? {} : { text: new TextDecoder().decode(read.bytes) })
	};
}

/** The records inside `dir`, which must itself resolve to a tree — missing and non-directory both fail. */
async function lsDirRecords(root: string, commit: string, dir: string, signal: AbortSignal): Promise<LsRecord[]> {
	const [self] = await lsTree(root, [commit, '--', dir], signal);

	if (!self) throw new RepoFilesError(`'${dir}' was not found at this ref.`, 404);
	if (self.type !== 'tree') throw new RepoFilesError(`'${dir}' is not a directory.`, 400);

	return lsTree(root, [commit, '--', `${dir}/`], signal);
}

async function lsTree(root: string, args: string[], signal: AbortSignal): Promise<LsRecord[]> {
	const out = await git(root, ['--literal-pathspecs', 'ls-tree', '-lz', '-l', ...args], signal);

	if (signal.aborted) throw timedOut();
	if (out.code !== 0) throw new Error(`git ls-tree failed: ${out.stderr.slice(0, 300)}`);

	return parseLsRecords(out.stdout);
}

function parseLsRecords(stdout: string): LsRecord[] {
	const records: LsRecord[] = [];

	for (const record of stdout.split('\0')) {
		const tab = record.indexOf('\t');

		if (tab < 0) continue;

		const [mode, type, sha, rawSize] = record.slice(0, tab).split(/\s+/);

		if (!mode || !type || !sha) continue;

		records.push({
			mode,
			type,
			sha,
			size: rawSize !== undefined && /^\d+$/.test(rawSize) ? Number(rawSize) : null,
			path: record.slice(tab + 1)
		});
	}

	return records;
}

async function toTreeEntry(root: string, record: LsRecord, signal: AbortSignal): Promise<RepoTreeEntry> {
	const base = { name: record.path.slice(record.path.lastIndexOf('/') + 1), path: record.path };
	const kind = kindOf(record);

	if (kind === 'dir' || kind === 'submodule') return { ...base, kind };
	if (kind === 'symlink') return { ...base, kind, target: await symlinkTarget(root, record.sha, signal) };

	return { ...base, kind, size: record.size ?? 0 };
}

function kindOf(record: LsRecord): RepoTreeEntryKind {
	if (record.type === 'tree') return 'dir';
	if (record.mode === '120000') return 'symlink';
	if (record.type === 'commit' || record.mode === '160000') return 'submodule';

	return 'file';
}

/** A symlink's target, exactly as stored; it is a path the panel may show but the server never opens. */
async function symlinkTarget(root: string, sha: string, signal: AbortSignal): Promise<string> {
	const read = await readBlob(root, sha, SYMLINK_TARGET_BYTES, signal);

	return new TextDecoder().decode(read.bytes);
}

async function blobSize(root: string, sha: string, signal: AbortSignal): Promise<number> {
	const out = await git(root, ['cat-file', '-s', sha], signal);

	if (signal.aborted) throw timedOut();
	if (out.code !== 0) throw new Error(`git cat-file failed: ${out.stderr.slice(0, 300)}`);

	return Number(out.stdout.trim());
}

/** True when the blob's first bytes hold a NUL, git's own binary rule. */
function isBinary(bytes: Uint8Array): boolean {
	return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * At most `cap` bytes of the blob, streamed so a huge blob is never held in
 * full: the read stops past the cap and `truncated` says more was there.
 */
async function readBlob(root: string, sha: string, cap: number, signal: AbortSignal): Promise<BlobRead> {
	const proc = Bun.spawn(['git', 'cat-file', 'blob', sha], {
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe',
		stdin: 'ignore'
	});

	const kill = () => proc.kill();

	signal.addEventListener('abort', kill, { once: true });

	try {
		const stderrDone = new Response(proc.stderr).text();
		const reader = proc.stdout.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		let over = false;

		for (;;) {
			const { done, value } = await reader.read();

			if (done) break;

			chunks.push(value);
			total += value.byteLength;

			if (total > cap) {
				over = true;
				proc.kill();
				break;
			}
		}

		const [code, stderr] = await Promise.all([proc.exited, stderrDone]);

		if (signal.aborted) throw timedOut();
		if (code !== 0 && !over) throw new Error(`git cat-file failed: ${stderr.slice(0, 300)}`);

		const bytes = new Uint8Array(Math.min(total, cap));
		let at = 0;

		for (const chunk of chunks) {
			bytes.set(chunk.subarray(0, bytes.length - at), at);
			at += Math.min(chunk.byteLength, bytes.length - at);
			if (at >= bytes.length) break;
		}

		return { bytes, truncated: over };
	} finally {
		signal.removeEventListener('abort', kill);
	}
}
