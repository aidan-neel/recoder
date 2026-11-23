import { mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../commands/runner.js';
import { env } from '../env.js';
import type { Provider } from '@recoder/shared';
import type { ReviewRevision } from '../evidence/evidence.js';
import { processOutput } from '../util/process.js';
import { RETRY_DELAYS_MS, retryTransientGit, summarizeGitFailure } from './git-network.js';
import { ensureSharedClone } from './shared-git.js';

export interface Sandbox {
	key: string;
	path: string;
	repoSlug: string;
	prNumber: number;
	headSha: string;
}

function sandboxKey(repoSlug: string, prNumber: number): string {
	return `${repoSlug.split('/').join('__')}__pr-${prNumber}`;
}

/** Where `prepareSandbox` puts a checkout: one folder per PR, or one per review when `reviewId` is given. */
export function sandboxLocation(repoSlug: string, prNumber: number, reviewId?: string): { key: string; path: string } {
	const key = sandboxKey(repoSlug, prNumber) + (reviewId ? '__' + reviewId : '');

	return { key, path: join(env.RECODER_WORKDIR, 'repos', key) };
}

function gitEnv(overrides?: Record<string, string>, provider?: Provider): Record<string, string> {
	const forge = credentials(provider, overrides);
	const entries = forge ? ['', ...forge.helpers].map((helper) => [`credential.${forge.scope}.helper`, helper]) : [];

	return {
		...overrides,
		GIT_TERMINAL_PROMPT: '0',
		...(entries.length
			? {
					GIT_CONFIG_COUNT: String(entries.length),
					...Object.fromEntries(
						entries.flatMap(([key, value], index) => [
							[`GIT_CONFIG_KEY_${index}`, key],
							[`GIT_CONFIG_VALUE_${index}`, value]
						])
					)
				}
			: {})
	};
}

/**
 * The credential scope and helpers of a forge, the token supplied only through
 * the environment; null for a local repository. The empty helper clears the
 * system and global helpers so a host-wide git config cannot answer for the
 * forge.
 */
function credentials(
	provider: Provider | undefined,
	overrides?: Record<string, string>
): { scope: string; helpers: string[] } | null {
	if (provider === 'github') return { scope: 'https://github.com', helpers: ['!gh auth git-credential'] };

	if (provider === 'gitlab' && overrides?.GITLAB_TOKEN) {
		return {
			scope: `https://${overrides.GITLAB_HOST || 'gitlab.com'}`,
			helpers: ['!f() { test "$1" = get && echo username=oauth2 && echo "password=$GITLAB_TOKEN"; }; f']
		};
	}

	return null;
}

/**
 * The forge's credential helpers as clone arguments, which writes them into the
 * checkout's own git config, scoped to this repository's URL alone. A partial
 * clone reads blobs on demand long after the clone, from commands that run
 * without the review's environment, so the checkout has to know how to reach
 * the forge by itself; no other repository can.
 */
function credentialConfig(
	cloneUrl: string,
	provider: Provider | undefined,
	overrides?: Record<string, string>
): string[] {
	const forge = credentials(provider, overrides);

	return forge ? ['', ...forge.helpers].flatMap((helper) => ['-c', `credential.${cloneUrl}.helper=${helper}`]) : [];
}

/** How one sandbox git command runs: its credentials and forge, where progress goes, and what stops it. */
interface GitAccess {
	overrides?: Record<string, string>;
	provider?: Provider;
	onProgress?: (message: string) => void;
	signal?: AbortSignal;
	/** The waits between retries of a transient network failure; tests pass a shorter policy. */
	retryDelaysMs?: number[];
}

/** The git commands that talk to the forge, the only ones a dropped connection can fail. */
const NETWORK_COMMANDS = new Set(['clone', 'fetch']);

/**
 * Runs git through the command runner. A stop is honoured before each command
 * starts, so a stopped review never begins its next clone or fetch, and it
 * ends the command that is running. Clone and fetch retry a dropped connection
 * with backoff, a clone from an empty destination, since git refuses to reuse
 * the partial one a dropped attempt leaves; every other command runs once.
 */
async function git(cwd: string, args: string[], label: string, access: GitAccess = {}): Promise<string> {
	const work = () => runGit(cwd, args, label, access);

	if (!NETWORK_COMMANDS.has(args[0] ?? '')) return work();

	return retryTransientGit(work, access.retryDelaysMs ?? RETRY_DELAYS_MS, {
		cleanUp: args[0] === 'clone' ? () => rm(args.at(-1)!, { recursive: true, force: true }) : undefined
	});
}

async function runGit(cwd: string, args: string[], label: string, access: GitAccess): Promise<string> {
	access.signal?.throwIfAborted();

	let lastReport = 0;

	const run = await runCommand({
		label,
		command: 'git',
		args,
		cwd,
		env: gitEnv(access.overrides, access.provider),
		signal: access.signal,
		onOutput: (chunk) => {
			const matches = [
				...chunk.matchAll(
					/(Receiving objects|Resolving deltas|Updating files|Counting objects|Compressing objects):\s+(\d+)%/g
				)
			];

			const match = matches.at(-1);

			if (match && Date.now() - lastReport > 500) {
				lastReport = Date.now();
				access.onProgress?.(match[1] + ': ' + match[2] + '%');
			}
		}
	});

	access.signal?.throwIfAborted();

	if (run.status !== 'succeeded') {
		throw new Error(`git ${args[0]} failed: ${summarizeGitFailure(run.logs)}`);
	}

	return run.logs.trim();
}

/**
 * Prepare an isolated checkout for a PR under RECODER_WORKDIR/repos.
 *
 * Review IDs give concurrent reviews separate checkouts.
 * GitHub auth uses the saved token through gh's credential helper, supplied
 * only in the subprocess environment, never in URLs or command arguments.
 *
 * The head is fetched into FETCH_HEAD (which never refuses, unlike fetching
 * into a ref) and checked out detached before the branch is reset onto it.
 * Re-runs of the same PR would otherwise fail with "refusing to fetch into
 * branch checked out at <path>".
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
	/** Stops the preparation before its next git command. */
	signal?: AbortSignal;
	/** The waits between retries of a transient network failure; tests pass a shorter policy. */
	retryDelaysMs?: number[];
}): Promise<Sandbox> {
	const { repoSlug, prNumber, repoUrl, fetchRef, branch, signal } = opts;
	const { key, path } = sandboxLocation(repoSlug, prNumber, opts.reviewId);

	const remote: GitAccess = {
		overrides: opts.env,
		provider: opts.provider,
		signal,
		retryDelaysMs: opts.retryDelaysMs
	};

	await mkdir(path, { recursive: true });

	if (!(await isCheckoutRoot(path, signal))) {
		opts.onProgress?.('Cloning repository into the review checkout');

		const cloneUrl = cloneUrlOf(repoSlug, repoUrl, opts.provider);

		const shared = await ensureRepoClone({
			repoSlug,
			repoUrl,
			provider: opts.provider,
			env: opts.env,
			signal,
			retryDelaysMs: opts.retryDelaysMs
		});

		await clearCloneDestination(path);

		await git(
			env.RECODER_WORKDIR,
			[
				'clone',
				'--progress',
				'--no-checkout',
				'--single-branch',
				'--filter=blob:none',
				...credentialConfig(cloneUrl, opts.provider, opts.env),
				...(shared ? ['--reference', shared] : []),
				'--',
				cloneUrl,
				path
			],
			'sandbox clone',
			{ ...remote, onProgress: opts.onProgress }
		);
	}

	opts.onProgress?.('Fetching the pull request head');

	await git(path, ['fetch', '--progress', 'origin', fetchRef.split(':')[0], '--force'], 'sandbox fetch', {
		...remote,
		onProgress: opts.onProgress
	});

	const fetchedSha = await git(path, ['rev-parse', 'FETCH_HEAD'], 'sandbox fetched sha', { signal });

	if (opts.expectedHeadSha && fetchedSha !== opts.expectedHeadSha) {
		throw new Error('PR head changed while preparing the review; retry to review the latest commit');
	}

	opts.onProgress?.('Checking out the pull request files');
	await git(path, ['checkout', '--force', '--detach', 'FETCH_HEAD'], 'sandbox detach', { signal });
	await git(path, ['checkout', '--force', '-B', branch, 'FETCH_HEAD'], 'sandbox checkout', { signal });

	const headSha = await git(path, ['rev-parse', 'HEAD'], 'sandbox sha', { signal });

	return { key, path, repoSlug, prNumber, headSha };
}

/**
 * Whether `path` is the root of its own checkout. Being inside a work tree is
 * not enough: a work dir under a folder that is itself a repository (a home
 * directory kept in git) would pass for a checkout that was never cloned, and
 * the fetch that follows would run against the outer repository.
 */
async function isCheckoutRoot(path: string, signal?: AbortSignal): Promise<boolean> {
	const root = await git(path, ['rev-parse', '--show-toplevel'], 'sandbox check', { signal }).catch(() => null);

	if (root === null) return false;

	return (await realpath(root)) === (await realpath(path));
}

/**
 * The shared bare copy of a hosted repository (`ensureSharedClone`), cloned
 * with the forge's credentials on first use and fetched at most once a minute.
 * Null when git cannot make it.
 */
export function ensureRepoClone(opts: {
	repoSlug: string;
	repoUrl: string;
	provider?: Provider;
	env?: Record<string, string>;
	/** Stops the clone or fetch; a stopped one leaves no copy behind. */
	signal?: AbortSignal;
	/** The waits between retries of a transient network failure; tests pass a shorter policy. */
	retryDelaysMs?: number[];
}): Promise<string | null> {
	const remote: GitAccess = {
		overrides: opts.env,
		provider: opts.provider,
		signal: opts.signal,
		retryDelaysMs: opts.retryDelaysMs
	};

	return ensureSharedClone({
		workDir: env.RECODER_WORKDIR,
		repoSlug: opts.repoSlug,
		cloneUrl: cloneUrlOf(opts.repoSlug, opts.repoUrl, opts.provider),
		run: (cwd, args, label) => git(cwd, args, label, remote)
	});
}

/** The URL git clones a repository from; GitHub's is rebuilt from the slug so a pasted web URL still clones. */
function cloneUrlOf(repoSlug: string, repoUrl: string, provider: Provider | undefined): string {
	return provider === 'github' ? 'https://github.com/' + repoSlug + '.git' : repoUrl;
}

/** Removes a checkout path a failed clone left half-built, which git refuses to clone over. */
async function clearCloneDestination(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}

/** Fetch the target branch, record immutable SHAs, and compute the merge-base patch. */
export async function sandboxRevisionDiff(
	path: string,
	baseRef: string,
	overrides?: Record<string, string>,
	provider?: Provider
): Promise<{ revision: ReviewRevision; diff: string }> {
	const revision = await sandboxRevision(path, baseRef, { overrides, provider });

	return { revision, diff: await revisionDiff(revision, { env: gitEnv(overrides, provider) }) };
}

/** Fetch the target branch and record immutable SHAs for the checkout's HEAD against it. */
export async function sandboxRevision(path: string, baseRef: string, remote: GitAccess = {}): Promise<ReviewRevision> {
	const local = { signal: remote.signal };

	await git(path, ['check-ref-format', 'refs/heads/' + baseRef], 'sandbox validate base', local);
	await git(path, ['fetch', 'origin', 'refs/heads/' + baseRef], 'sandbox fetch base', remote);

	const targetSha = await git(path, ['rev-parse', 'FETCH_HEAD'], 'sandbox target sha', local);
	const mergeBaseSha = await git(path, ['merge-base', 'FETCH_HEAD', 'HEAD'], 'sandbox merge base', local);
	const headSha = await git(path, ['rev-parse', 'HEAD'], 'sandbox head sha', local);

	return { checkoutPath: path, headSha, targetSha, mergeBaseSha, targetRef: baseRef };
}

/**
 * The patch from the merge base to the head, in the one format the pipeline
 * reads. `pathspecs` narrow it to some paths; `signal` stops git. In a partial
 * clone the diff reads blobs on demand, so `env` carries the forge's
 * credentials for those fetches.
 */
export async function revisionDiff(
	revision: Pick<ReviewRevision, 'checkoutPath' | 'mergeBaseSha' | 'headSha'>,
	opts: { pathspecs?: string[]; signal?: AbortSignal; env?: Record<string, string> } = {}
): Promise<string> {
	const proc = Bun.spawn(
		[
			'git',
			'-c',
			'core.quotePath=false',
			'diff',
			'--no-ext-diff',
			'--no-textconv',
			'--no-color',
			'-M',
			'-C',
			'--find-copies-harder',
			'--src-prefix=a/',
			'--dst-prefix=b/',
			revision.mergeBaseSha,
			revision.headSha,
			'--',
			...(opts.pathspecs ?? [])
		],
		{
			cwd: revision.checkoutPath,
			stdout: 'pipe',
			stderr: 'pipe',
			signal: opts.signal,
			...(opts.env ? { env: { ...process.env, ...opts.env } } : {})
		}
	);

	const { stdout: diff, stderr, code } = await processOutput(proc);

	if (code !== 0) throw new Error('Local PR diff failed: ' + summarizeGitFailure(stderr));

	return diff;
}

/** Compute the PR patch from its merge base, without API limits or log truncation. */
export async function sandboxDiff(
	path: string,
	baseRef: string,
	overrides?: Record<string, string>,
	provider?: Provider
): Promise<string> {
	return (await sandboxRevisionDiff(path, baseRef, overrides, provider)).diff;
}
