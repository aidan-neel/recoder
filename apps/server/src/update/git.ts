import type { UpdateCommit } from '@recoder/shared';
import { requireSuccess, spawnProcess, type RunProcess } from './run';

/** Fetches and merges may move a lot of objects on a slow line. */
const FETCH_TIMEOUT_MS = 300_000;

/** Where HEAD and its upstream stand, and what lies between them. */
export interface GitInspection {
	commit: string;
	/** Undefined on a detached HEAD. */
	branch?: string;
	/** The upstream ref (`origin/main`), undefined when the branch has none. */
	upstream?: string;
	/** Repo-relative paths with uncommitted changes, untracked files included. */
	dirtyPaths: string[];
	/** Commits on HEAD the upstream lacks, and on the upstream HEAD lacks. */
	ahead: number;
	behind: number;
	/** What upstream would bring in. */
	commits: UpdateCommit[];
	paths: string[];
}

/** A git checkout the update pulls into. All commands run with `-C root` and never through a shell. */
export interface GitCheckout {
	current(): Promise<{ commit: string; branch?: string }>;
	inspect(): Promise<GitInspection>;
	fetch(): Promise<void>;
	mergeFfOnly(): Promise<void>;
	/** The branches on the remote, by name, as of the last fetch. */
	remoteBranches(): Promise<string[]>;
	/** What switching to the remote `branch` would bring in, against HEAD. */
	compareBranch(branch: string): Promise<{ commits: UpdateCommit[]; paths: string[] }>;
	/** Checks out `branch` (tracking the remote's when there is no local one) and moves it to the remote tip. */
	switchTo(branch: string): Promise<void>;
}

/** The remote branches are read from and switched to. */
const REMOTE = 'origin';

/** The local ref the upstream is compared against. */
const UPSTREAM = '@{u}';

/**
 * The checkout at `root`, run through `run` (a fake `git` on PATH in tests).
 * `env` carries a test's PATH to every invocation.
 */
export function gitCheckout(root: string, run: RunProcess = spawnProcess, env?: Record<string, string>): GitCheckout {
	const git = async (args: string[], timeoutMs?: number) => {
		const argv = ['git', '-C', root, ...args];

		return requireSuccess(argv, await run(argv, { env, timeoutMs }));
	};

	const lines = (text: string) => text.split('\n').filter((line) => line !== '');

	return {
		async current() {
			const result = await git(['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']);
			const [commit, branch] = result.stdout.trim().split('\n');

			return { commit, ...(branch && branch !== 'HEAD' ? { branch } : {}) };
		},
		async inspect() {
			const [commit, branch, upstream, dirty, counts, log, diff] = await Promise.all([
				git(['rev-parse', 'HEAD']),
				git(['rev-parse', '--abbrev-ref', 'HEAD']),
				run(['git', '-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', UPSTREAM], { env }),
				git(['status', '--porcelain']),
				run(['git', '-C', root, 'rev-list', '--left-right', '--count', `HEAD...${UPSTREAM}`], { env }),
				run(['git', '-C', root, 'log', '--format=%H%x00%s', `HEAD..${UPSTREAM}`], { env }),
				run(['git', '-C', root, 'diff', '--name-only', `HEAD..${UPSTREAM}`], { env })
			]);

			const [ahead = 0, behind = 0] = counts.exitCode === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [];

			return {
				commit: commit.stdout.trim(),
				branch: branch.stdout.trim() === 'HEAD' ? undefined : branch.stdout.trim(),
				upstream: upstream.exitCode === 0 ? upstream.stdout.trim() : undefined,
				dirtyPaths: lines(dirty.stdout),
				ahead,
				behind,
				commits: log.exitCode === 0 ? lines(log.stdout).map(toCommit) : [],
				paths: diff.exitCode === 0 ? lines(diff.stdout) : []
			};
		},

		async fetch() {
			await git(['fetch', '--quiet', '--prune'], FETCH_TIMEOUT_MS);
		},

		async mergeFfOnly() {
			await git(['merge', '--ff-only', UPSTREAM], FETCH_TIMEOUT_MS);
		},

		async remoteBranches() {
			const refs = await git(['for-each-ref', '--format=%(refname:lstrip=3)', `refs/remotes/${REMOTE}`]);

			return lines(refs.stdout).filter((name) => name !== 'HEAD');
		},

		async compareBranch(branch) {
			const target = `${REMOTE}/${branch}`;

			const [log, diff] = await Promise.all([
				git(['log', '--format=%H%x00%s', `HEAD..${target}`]),
				git(['diff', '--name-only', 'HEAD', target])
			]);

			return { commits: lines(log.stdout).map(toCommit), paths: lines(diff.stdout) };
		},

		async switchTo(branch) {
			const local = await run(['git', '-C', root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
				env
			});

			await git(local.exitCode === 0 ? ['switch', branch] : ['switch', '--track', `${REMOTE}/${branch}`]);
			await git(['merge', '--ff-only', `${REMOTE}/${branch}`], FETCH_TIMEOUT_MS);
		}
	};
}

/** One `%H%x00%s` line of `git log`. */
function toCommit(line: string): UpdateCommit {
	const [sha = '', subject = ''] = line.split('\0');

	return { sha, subject };
}
