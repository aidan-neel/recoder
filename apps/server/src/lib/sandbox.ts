import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../commands/runner.js';
import { env } from '../env.js';

export interface Sandbox {
	key: string;
	path: string;
	repoSlug: string;
	prNumber: number;
	headSha: string;
}

export function sandboxKey(repoSlug: string, prNumber: number): string {
	return `${repoSlug.split('/').join('__')}__pr-${prNumber}`;
}

async function git(cwd: string, args: string[], label: string): Promise<string> {
	const run = await runCommand({ label, command: 'git', args, cwd });
	if (run.status !== 'succeeded') {
		throw new Error(`git ${args[0]} failed: ${run.logs.slice(-2000)}`);
	}
	return run.logs.trim();
}

/**
 * Prepare an isolated checkout for a PR under RECODER_WORKDIR/repos.
 *
 * Idempotent: an existing checkout is refreshed (fetch + force checkout).
 * Auth: relies on the host (`gh auth setup-git` / credential helper) or
 * public repos. Never embeds tokens — they would land in run logs.
 */
export async function prepareSandbox(opts: {
	repoSlug: string;
	prNumber: number;
	repoUrl: string;
	/** Provider fetch ref, e.g. `pull/7/head:pr-7` (GitHub) or `merge-requests/7/head:mr-7` (GitLab). */
	fetchRef: string;
	/** Local branch to check out. */
	branch: string;
}): Promise<Sandbox> {
	const { repoSlug, prNumber, repoUrl, fetchRef, branch } = opts;
	const path = join(env.RECODER_WORKDIR, 'repos', sandboxKey(repoSlug, prNumber));
	await mkdir(path, { recursive: true });

	const inside = await git(path, ['rev-parse', '--is-inside-work-tree'], 'sandbox check')
		.then(() => true)
		.catch(() => false);

	if (!inside) {
		await git(env.RECODER_WORKDIR, ['clone', repoUrl, path], 'sandbox clone');
	}

	// Fetch into FETCH_HEAD (never refuses, unlike fetching into a ref),
	// detach so the target branch is never checked out, then reset it.
	// Re-runs of the same PR would otherwise fail with "refusing to fetch
	// into branch checked out at <path>".
	await git(path, ['fetch', 'origin', fetchRef.split(':')[0], '--force'], 'sandbox fetch');
	await git(path, ['checkout', '--force', '--detach'], 'sandbox detach');
	await git(path, ['checkout', '--force', '-B', branch, 'FETCH_HEAD'], 'sandbox checkout');
	const headSha = await git(path, ['rev-parse', 'HEAD'], 'sandbox sha');

	return { key: sandboxKey(repoSlug, prNumber), path, repoSlug, prNumber, headSha };
}

/** Remove a sandbox checkout. No retention policy yet — call explicitly. */
export async function removeSandbox(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}
