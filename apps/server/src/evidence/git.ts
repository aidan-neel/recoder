import { processOutput, type ProcessOutput } from '../util/process.js';

export async function git(
	cwd: string,
	args: string[],
	signal?: AbortSignal,
	env?: Record<string, string>
): Promise<ProcessOutput> {
	const proc = Bun.spawn(['git', ...args], {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		stdin: 'ignore',
		...(env ? { env: { ...process.env, ...env } } : {})
	});

	const abort = () => proc.kill();

	signal?.addEventListener('abort', abort, { once: true });

	try {
		return await processOutput(proc);
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}

/** Reads a text blob at a revision, refusing symlinks, submodules and binary files. */
export async function readBlob(
	cwd: string,
	sha: string,
	path: string,
	signal?: AbortSignal
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const listed = await git(cwd, ['ls-tree', '-z', sha, '--', path], signal);

	if (listed.code !== 0) return { ok: false, error: listed.stderr.slice(0, 400) || 'path not found' };

	const record = listed.stdout.split('\0').find(Boolean);

	if (!record) return { ok: false, error: 'path not found at this revision' };

	const tab = record.indexOf('\t');
	const meta = tab === -1 ? record : record.slice(0, tab);
	const [mode, type, hash] = meta.split(/\s+/);

	if (mode === '120000') return { ok: false, error: 'refusing to follow symlink' };
	if (type === 'commit' || mode === '160000') return { ok: false, error: 'refusing to enter submodule' };
	if (type !== 'blob' || !hash) return { ok: false, error: 'not a file at this revision' };

	const blob = await git(cwd, ['cat-file', '-p', hash], signal);

	if (blob.code !== 0) return { ok: false, error: blob.stderr.slice(0, 400) || 'read failed' };
	if (blob.stdout.includes('\0')) return { ok: false, error: 'binary file' };

	return { ok: true, text: blob.stdout };
}

/** The paths that `ls-tree` lists as regular files (not symlinks, submodules or trees). */
export function regularFiles(lsTreeOutput: string): Set<string> {
	const found = new Set<string>();

	for (const record of lsTreeOutput.split('\0')) {
		const tab = record.indexOf('\t');

		if (tab < 0) continue;

		const [mode, type] = record.slice(0, tab).split(/\s+/);

		if (type === 'blob' && (mode === '100644' || mode === '100755')) found.add(record.slice(tab + 1));
	}

	return found;
}
