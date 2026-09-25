import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../commands/runner.js';
import { env } from '../env.js';
import type { Provider } from '@recoder/shared';
import type { ReviewRevision } from './evidence.js';

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

function gitEnv(overrides?: Record<string, string>, provider?: Provider): Record<string, string> {
	return {
		...overrides,
		GIT_TERMINAL_PROMPT: '0',
		...(provider === 'github' ? {
			GIT_CONFIG_COUNT: '2',
			GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
			GIT_CONFIG_VALUE_0: '',
			GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
			GIT_CONFIG_VALUE_1: '!gh auth git-credential'
		} : {}),
		...(provider === 'gitlab' && overrides?.GITLAB_TOKEN ? gitlabCredentials(overrides.GITLAB_HOST || 'gitlab.com') : {})
	};
}

/** The connected GitLab token as the git password, read from the env at call time so it never lands in args or URLs. */
function gitlabCredentials(host: string): Record<string, string> {
	const scope = `credential.https://${host}.helper`;
	return {
		GIT_CONFIG_COUNT: '2',
		GIT_CONFIG_KEY_0: scope,
		GIT_CONFIG_VALUE_0: '',
		GIT_CONFIG_KEY_1: scope,
		GIT_CONFIG_VALUE_1: '!f() { test "$1" = get && echo username=oauth2 && echo "password=$GITLAB_TOKEN"; }; f'
	};
}

async function git(cwd: string, args: string[], label: string, overrides?: Record<string, string>, provider?: Provider, onProgress?: (message: string) => void): Promise<string> {
	let lastReport = 0;
	const run = await runCommand({ label, command: 'git', args, cwd, env: gitEnv(overrides, provider),
		onOutput: (chunk) => {
			const matches = [...chunk.matchAll(/(Receiving objects|Resolving deltas|Updating files|Counting objects|Compressing objects):\s+(\d+)%/g)];
			const match = matches.at(-1);
			if (match && Date.now() - lastReport > 500) {
				lastReport = Date.now();
				onProgress?.(match[1] + ': ' + match[2] + '%');
			}
		}
	});
	if (run.status !== 'succeeded') {
		throw new Error(`git ${args[0]} failed: ${run.logs.slice(-2000)}`);
	}
	return run.logs.trim();
}

/**
 * Prepare an isolated checkout for a PR under RECODER_WORKDIR/repos.
 *
 * Review IDs give concurrent reviews separate checkouts.
 * GitHub auth uses the saved token through gh's credential helper, supplied
 * only in the subprocess environment, never in URLs or command arguments.
 */
export async function prepareSandbox(opts: {
	repoSlug: string;
	prNumber: number;
	repoUrl: string;
	/** Provider fetch ref, e.g. `pull/7/head:pr-7` (GitHub) or `merge-requests/7/head:mr-7` (GitLab). */
	fetchRef: string;
	/** Local branch to check out. */
	branch: string;
	reviewId?: string;
	provider?: Provider;
	env?: Record<string, string>;
	expectedHeadSha?: string;
	onProgress?: (message: string) => void;
}): Promise<Sandbox> {
	const { repoSlug, prNumber, repoUrl, fetchRef, branch } = opts;
	const key = sandboxKey(repoSlug, prNumber) + (opts.reviewId ? '__' + opts.reviewId : '');
	const path = join(env.RECODER_WORKDIR, 'repos', key);
	await mkdir(path, { recursive: true });

	const inside = await git(path, ['rev-parse', '--is-inside-work-tree'], 'sandbox check')
		.then(() => true)
		.catch(() => false);

	if (!inside) {
		opts.onProgress?.('Cloning repository into the review checkout');
		const cloneUrl = opts.provider === 'github' ? 'https://github.com/' + repoSlug + '.git' : repoUrl;
		await git(env.RECODER_WORKDIR, ['clone', '--progress', '--no-checkout', '--', cloneUrl, path], 'sandbox clone', opts.env, opts.provider, opts.onProgress);
	}

	// Fetch into FETCH_HEAD (never refuses, unlike fetching into a ref),
	// detach so the target branch is never checked out, then reset it.
	// Re-runs of the same PR would otherwise fail with "refusing to fetch
	// into branch checked out at <path>".
	opts.onProgress?.('Fetching the pull request head');
	await git(path, ['fetch', '--progress', 'origin', fetchRef.split(':')[0], '--force'], 'sandbox fetch', opts.env, opts.provider, opts.onProgress);
	const fetchedSha = await git(path, ['rev-parse', 'FETCH_HEAD'], 'sandbox fetched sha');
	if (opts.expectedHeadSha && fetchedSha !== opts.expectedHeadSha) {
		throw new Error('PR head changed while preparing the review; retry to review the latest commit');
	}
	opts.onProgress?.('Checking out the pull request files');
	await git(path, ['checkout', '--force', '--detach', 'FETCH_HEAD'], 'sandbox detach');
	await git(path, ['checkout', '--force', '-B', branch, 'FETCH_HEAD'], 'sandbox checkout');
	const headSha = await git(path, ['rev-parse', 'HEAD'], 'sandbox sha');

	return { key, path, repoSlug, prNumber, headSha };
}

/** Fetch the target branch, record immutable SHAs, and compute the merge-base patch. */
export async function sandboxRevisionDiff(
	path: string,
	baseRef: string,
	overrides?: Record<string, string>,
	provider?: Provider
): Promise<{ revision: ReviewRevision; diff: string }> {
	await git(path, ['check-ref-format', 'refs/heads/' + baseRef], 'sandbox validate base');
	await git(path, ['fetch', 'origin', 'refs/heads/' + baseRef], 'sandbox fetch base', overrides, provider);
	const targetSha = await git(path, ['rev-parse', 'FETCH_HEAD'], 'sandbox target sha');
	const mergeBaseSha = await git(path, ['merge-base', 'FETCH_HEAD', 'HEAD'], 'sandbox merge base');
	const headSha = await git(path, ['rev-parse', 'HEAD'], 'sandbox head sha');
	const proc = Bun.spawn(['git', '-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', mergeBaseSha, headSha, '--'], {
		cwd: path, stdout: 'pipe', stderr: 'pipe'
	});
	const [diff, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited
	]);
	if (code !== 0) throw new Error('Local PR diff failed: ' + stderr.slice(-2000));
	return {
		revision: { checkoutPath: path, headSha, targetSha, mergeBaseSha, targetRef: baseRef },
		diff
	};
}

/** Compute the PR patch from its merge base, without API limits or log truncation. */
export async function sandboxDiff(path: string, baseRef: string, overrides?: Record<string, string>, provider?: Provider): Promise<string> {
	return (await sandboxRevisionDiff(path, baseRef, overrides, provider)).diff;
}

/** Remove a sandbox checkout. No retention policy yet — call explicitly. */
export async function removeSandbox(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}
