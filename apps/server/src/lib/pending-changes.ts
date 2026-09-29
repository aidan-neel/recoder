import type { PendingChanges, PendingFile } from '@recoder/shared';
import { FixError } from './fix.js';

/**
 * The developer's own changes in a review checkout: applied fixes sit in the
 * working tree until they pick which files to commit, write the message, and
 * push. Nothing here runs without an explicit request.
 *
 * `refs/recoder/pushed` marks the last commit known to be on the PR branch,
 * so local commits that haven't been pushed yet can be listed and undone.
 */

const PUSHED_REF = 'refs/recoder/pushed';

async function git(cwd: string, args: string[], status: 409 | 502 = 409, stdin?: string): Promise<string> {
	const proc = Bun.spawn(['git', ...args], {
		cwd,
		stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
	});
	const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) throw new FixError(status, `git ${args[0]} failed: ${(stderr || stdout).trim().slice(-1500)}`);
	return stdout;
}

/** Repo-relative paths only: nothing absolute, no parent segments, no `.git`. */
export function safePaths(paths: string[]): string[] {
	const clean = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
	for (const path of clean) {
		if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.git')) throw new FixError(400, `invalid path: ${path}`);
	}
	return clean;
}

/** False while the checkout is still being cloned (no commit checked out yet). */
async function isReady(cwd: string): Promise<boolean> {
	return git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
}

async function requireReady(cwd: string): Promise<void> {
	if (!await isReady(cwd)) throw new FixError(409, 'The checkout is still being prepared. Try again in a moment.');
}

async function pushedBase(cwd: string): Promise<string> {
	try {
		return (await git(cwd, ['rev-parse', '--verify', '-q', PUSHED_REF])).trim();
	} catch {
		// Checkouts made before this ref existed: anything committed then was pushed with it.
		const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
		await git(cwd, ['update-ref', PUSHED_REF, head]);
		return head;
	}
}

/** Mark the checkout's current HEAD as what the PR branch has (after checkout or push). */
export async function markPushed(cwd: string): Promise<void> {
	await git(cwd, ['update-ref', PUSHED_REF, 'HEAD']);
}

/** Uncommitted files (with their diffs) and local commits not yet pushed. */
export async function listPendingChanges(cwd: string): Promise<PendingChanges> {
	if (!await isReady(cwd)) return { files: [], commits: [] };
	const base = await pushedBase(cwd);
	// -z keeps paths with spaces intact; untracked files are listed individually.
	const status = (await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter(Boolean);
	const files: PendingFile[] = [];
	for (let i = 0; i < status.length; i++) {
		const entry = status[i];
		const code = entry.slice(0, 2);
		const path = entry.slice(3);
		// A rename's original path follows as its own entry.
		if (code.includes('R')) i++;
		const kind: PendingFile['status'] = code === '??' || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : code.includes('R') ? 'renamed' : 'modified';
		const patch = code === '??' ? await untrackedPatch(cwd, path) : await git(cwd, ['diff', '--no-color', 'HEAD', '--', path]);
		files.push({ path, status: kind, patch });
	}
	const log = (await git(cwd, ['log', '--format=%H%x1f%s%x1f%an%x1f%aI', `${base}..HEAD`])).split('\n').filter(Boolean);
	const commits = log.map((line) => {
		const [sha, subject, author, at] = line.split('\x1f');
		return { sha, subject, author, at };
	});
	return { files, commits };
}

/** Untracked files have no diff against HEAD; show them as added. */
async function untrackedPatch(cwd: string, path: string): Promise<string> {
	const text = await Bun.file(`${cwd}/${path}`).text().catch(() => '');
	const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
	return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n') + '\n';
}

/** Commit exactly the chosen files with the developer's message, as the host's git identity. */
export async function commitPendingChanges(cwd: string, paths: string[], message: string): Promise<{ sha: string }> {
	await requireReady(cwd);
	const chosen = safePaths(paths);
	if (!chosen.length) throw new FixError(400, 'Choose at least one file to commit.');
	if (!message.trim()) throw new FixError(400, 'Write a commit message.');
	// Pin what's already pushed before HEAD moves, so this commit counts as unpushed.
	await pushedBase(cwd);
	await git(cwd, ['add', '-A', '--', ...chosen]);
	const identity = (await git(cwd, ['config', 'user.email']).catch(() => '')).trim()
		? []
		: ['-c', 'user.name=Recoder', '-c', 'user.email=recoder@localhost'];
	// Pathspecs commit only these files, even if something else was staged. The message goes in verbatim.
	await git(cwd, [...identity, 'commit', '-q', '--cleanup=verbatim', '-F', '-', '--', ...chosen], 409, message.trim() + '\n');
	return { sha: (await git(cwd, ['rev-parse', 'HEAD'])).trim() };
}

/** Push local commits to the PR branch. */
export async function pushPendingCommits(cwd: string, headRef: string): Promise<{ sha: string; pushed: number }> {
	await requireReady(cwd);
	const base = await pushedBase(cwd);
	const count = Number((await git(cwd, ['rev-list', '--count', `${base}..HEAD`])).trim()) || 0;
	if (!count) throw new FixError(409, 'There are no commits to push.');
	try {
		await git(cwd, ['push', 'origin', `HEAD:${headRef}`], 502);
	} catch (err) {
		throw new FixError(502, `The push failed (check push access, or pull if the branch moved): ${err instanceof Error ? err.message : String(err)}`);
	}
	await markPushed(cwd);
	return { sha: (await git(cwd, ['rev-parse', 'HEAD'])).trim(), pushed: count };
}

/** Throw away uncommitted changes to these files (restores tracked files, deletes new ones). */
export async function discardPendingChanges(cwd: string, paths: string[]): Promise<void> {
	await requireReady(cwd);
	const chosen = safePaths(paths);
	if (!chosen.length) return;
	const tracked = (await git(cwd, ['ls-files', '-z', '--', ...chosen])).split('\0').filter(Boolean);
	const inHead = new Set((await git(cwd, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...chosen])).split('\0').filter(Boolean));
	const restore = chosen.filter((path) => inHead.has(path));
	if (restore.length) await git(cwd, ['checkout', '-q', 'HEAD', '--', ...restore]);
	const added = chosen.filter((path) => !inHead.has(path));
	if (added.length) {
		if (tracked.some((path) => added.includes(path))) await git(cwd, ['rm', '-q', '--cached', '-f', '--', ...added.filter((path) => tracked.includes(path))]);
		await git(cwd, ['clean', '-q', '-f', '--', ...added]);
	}
}

/** Undo the latest unpushed commit; its changes go back to the working tree. */
export async function undoLastCommit(cwd: string): Promise<void> {
	await requireReady(cwd);
	const base = await pushedBase(cwd);
	const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
	if (head === base) throw new FixError(409, 'The latest commit is already pushed.');
	await git(cwd, ['reset', '-q', '--mixed', 'HEAD~1']);
}

/** True when the checkout holds changes or commits the developer hasn't pushed. */
export async function hasPendingChanges(cwd: string): Promise<boolean> {
	const pending = await listPendingChanges(cwd).catch(() => null);
	return !!pending && (pending.files.length > 0 || pending.commits.length > 0);
}
