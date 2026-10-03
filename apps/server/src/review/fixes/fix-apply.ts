import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixEdit } from '@recoder/shared';
import { runCommand } from '../../commands/runner.js';
import { EditMismatchError, patchFromEdits } from './fix-edits.js';

/** Fix-application failure with the HTTP status the route should answer. */
export class FixError extends Error {
	status: 400 | 409 | 502;
	sha?: string;

	constructor(status: 400 | 409 | 502, message: string, sha?: string) {
		super(message);
		this.status = status;
		this.sha = sha;
	}
}

/** Run git in a checkout, mapping failures to FixError. */
async function git(cwd: string, args: string[], label: string, status: 409 | 502 = 502): Promise<string> {
	let run;

	try {
		run = await runCommand({ label, command: 'git', args, cwd });
	} catch (err) {
		throw new FixError(status, err instanceof Error ? err.message : String(err));
	}

	if (run.status !== 'succeeded') {
		throw new FixError(status, `git ${args[0]} failed: ${run.logs.slice(-2000)}`);
	}

	return run.logs.trim();
}

async function writeTempPatch(patch: string): Promise<{ dir: string; file: string }> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-'));
	const file = join(dir, 'fix.patch');

	await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`);

	return { dir, file };
}

/** Repo-relative paths a patch touches (`+++ b/<path>` lines). */
function patchPaths(patch: string): string[] {
	const paths = new Set<string>();

	for (const match of patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)) {
		const path = match[1].trim();

		if (path !== '/dev/null' && path !== '' && !path.startsWith('/') && !path.includes('..')) {
			paths.add(path);
		}
	}

	return [...paths];
}

/** Check a patch against a checkout without applying it. */
export async function patchApplies(sandboxPath: string, patch: string): Promise<boolean> {
	const { dir, file } = await writeTempPatch(patch);

	try {
		const run = await runCommand({
			label: 'fix apply check',
			command: 'git',
			args: ['apply', '--recount', '--check', file],
			cwd: sandboxPath
		});

		return run.status === 'succeeded';
	} catch {
		return false;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

interface ApplyFixInput {
	sandboxPath: string;
	patch: string;
	/** When present, the patch is rebuilt from these against the current code. */
	edits?: FixEdit[];
	summary: string;
	file: string;
	line: number;
	message: string;
}

/** The patch to apply: rebuilt from the edits when there are any, so it fits the current code. */
async function currentPatch(input: Pick<ApplyFixInput, 'sandboxPath' | 'patch' | 'edits'>): Promise<string> {
	if (!input.edits?.length) return input.patch.trim();

	try {
		return await patchFromEdits(input.sandboxPath, input.edits);
	} catch (err) {
		if (err instanceof EditMismatchError)
			throw new FixError(409, 'The code changed since this fix was written. Write the fix again.');
		throw err;
	}
}

/**
 * Validate and apply a suggested patch to a review checkout's working tree.
 * Nothing is staged or committed: the developer chooses what to commit, with
 * their own message, and when to push (`pending-changes.ts`).
 */
export async function applyFixToWorktree(
	input: Omit<ApplyFixInput, 'summary' | 'file' | 'line' | 'message'>
): Promise<{ paths: string[] }> {
	const patch = await currentPatch(input);

	if (!/^---\s/m.test(patch) || !/^\+\+\+\s/m.test(patch)) {
		throw new FixError(409, 'not a unified diff patch');
	}

	const paths = patchPaths(patch);

	if (paths.length === 0) throw new FixError(409, 'patch touches no files');

	const { dir, file } = await writeTempPatch(patch);

	try {
		try {
			await git(input.sandboxPath, ['apply', '--recount', '--check', file], 'fix apply check', 409);
		} catch (err) {
			if (err instanceof FixError) {
				throw new FixError(409, 'This fix no longer applies to the latest code. Write the fix again.');
			}

			throw err;
		}

		await git(input.sandboxPath, ['apply', '--recount', file], 'fix apply', 409);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}

	return { paths };
}

/** Apply a suggested patch and commit it (the throwaway CI verify branch only). */
export async function applyFixCommit(input: ApplyFixInput): Promise<{ sha: string }> {
	const { paths } = await applyFixToWorktree(input);

	await git(input.sandboxPath, ['add', '--', ...paths], 'fix stage', 409);

	const message = `recoder: ${input.summary}\n\nFixes ${input.file}:${input.line} — ${input.message}`;

	await git(
		input.sandboxPath,
		['-c', 'user.name=recoder', '-c', 'user.email=recoder@localhost', 'commit', '-m', message],
		'fix commit',
		502
	);

	const sha = await git(input.sandboxPath, ['rev-parse', 'HEAD'], 'fix sha');

	return { sha };
}

/** One git operation at a time per sandbox (apply and verify both move HEAD). */
const sandboxLocks = new Map<string, Promise<unknown>>();

export function withSandboxLock<T>(sandboxPath: string, fn: () => Promise<T>): Promise<T> {
	const previous = sandboxLocks.get(sandboxPath) ?? Promise.resolve();
	const run = previous.catch(() => undefined).then(fn);

	sandboxLocks.set(
		sandboxPath,
		run.catch(() => undefined)
	);

	return run;
}

/** Temporary branches Recoder pushes to run CI on a fix; nothing else may be deleted. */
export const VERIFY_BRANCH_PREFIX = 'recoder/fix-';

/**
 * Verify a fix on CI without touching the PR branch: commit the patch in a
 * throwaway worktree at the current HEAD and force-push it as `recoder/fix-…`.
 * The checkout's working tree (uncommitted fixes included) is never touched.
 */
export async function pushVerifyBranch(input: ApplyFixInput & { branch: string }): Promise<{ sha: string }> {
	if (!input.branch.startsWith(VERIFY_BRANCH_PREFIX)) throw new FixError(409, 'invalid verify branch');

	const path = input.sandboxPath;
	const worktree = await mkdtemp(join(tmpdir(), 'recoder-verify-'));

	await git(path, ['worktree', 'add', '-q', '--detach', worktree, 'HEAD'], 'verify worktree', 409);

	try {
		const { sha } = await applyFixCommit({ ...input, sandboxPath: worktree });

		try {
			await git(worktree, ['push', '-f', 'origin', `HEAD:refs/heads/${input.branch}`], 'verify push', 502);
		} catch (err) {
			if (err instanceof FixError)
				throw new FixError(502, `couldn't push the fix branch (check push access): ${err.message}`);
			throw err;
		}

		return { sha };
	} finally {
		await git(path, ['worktree', 'remove', '--force', worktree], 'verify cleanup').catch(() => undefined);
		await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
	}
}

/** Remove a verify branch from the remote (after applying or discarding the fix). */
export async function deleteVerifyBranch(sandboxPath: string, branch: string): Promise<void> {
	if (!branch.startsWith(VERIFY_BRANCH_PREFIX)) throw new FixError(409, 'invalid verify branch');
	await git(sandboxPath, ['push', 'origin', '--delete', branch], 'verify delete', 502);
}
