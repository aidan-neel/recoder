import type { Repo, Review } from '@recoder/shared';
import { git } from '../evidence/git';
import { reviewCheckoutPath } from '../review/session/review-checkout';
import { db } from '../store';
import { RepoFilesError, timedOut } from './errors';
import { hasGitObjects, repoGitCopy } from './git-copy';

/** The most review checkouts tried for a ref the repo's own copy lacks. */
const MAX_REVIEW_DIR_CANDIDATES = 8;

/**
 * How long one request waits for the repo's copy to be cloned or fetched,
 * inside the route's git budget and Bun's 10 second idle timeout. A clone that
 * runs longer answers 503, and the panel asks again.
 */
const COPY_WAIT_MS = 6_000;

/** A git copy on this server plus the resolved commit to read in it. */
export interface RepoCommitSource {
	root: string;
	commit: string;
}

/**
 * The git copy that holds `ref`: the repository itself for a local repo, else
 * the shared bare copy reviews fetch into (cloned now when there is none),
 * then the checkouts reviews left behind — a pull request's head lives only
 * there until it merges. `ref` omitted reads the default branch, like the
 * repository chat. The checkouts are consulted only when the repo's own copy
 * cannot resolve `ref`. Answers 503 while the first clone runs, 502 when no
 * copy could be made, and 404 when no copy holds `ref`.
 */
export async function resolveCommit(
	repo: Repo,
	ref: string | undefined,
	signal: AbortSignal
): Promise<RepoCommitSource> {
	const copy = await repoGitCopy(repo, COPY_WAIT_MS);
	const primary = copy.state === 'ready' ? copy.path : null;

	if (primary) {
		const found = await resolveIn([primary], repo, ref, primary, signal);

		if (found) return found;
	}

	const checkouts = await reviewDirs(repo, primary);
	const found = await resolveIn(checkouts, repo, ref, primary, signal);

	if (found) return found;

	if (copy.state === 'copying') {
		throw new RepoFilesError('Copying the repository to this server; try again in a moment.', 503);
	}

	if (copy.state === 'missing') {
		throw new RepoFilesError(copy.reason, 502);
	}

	throw new RepoFilesError(
		ref === undefined ? `The default branch '${repo.defaultBranch}' was not found.` : `Ref '${ref}' was not found.`,
		404
	);
}

/** `ref` in each of `dirs`, first hit wins; null when none resolves it. */
async function resolveIn(
	dirs: string[],
	repo: Repo,
	ref: string | undefined,
	primary: string | null,
	signal: AbortSignal
): Promise<RepoCommitSource | null> {
	for (const root of dirs) {
		for (const name of refNames(repo, ref, root, primary)) {
			const commit = await revParse(root, name, signal);

			if (signal.aborted) throw timedOut();
			if (commit) return { root, commit };
		}
	}

	return null;
}

/**
 * The names `ref` is looked up under: itself when given, else the default
 * branch — `HEAD` too in the repo's own copy, since a checkout's HEAD is its
 * pull request's head, not the default branch.
 */
function refNames(repo: Repo, ref: string | undefined, root: string, primary: string | null): string[] {
	if (ref !== undefined) return [ref];

	const branch = `refs/heads/${repo.defaultBranch}`;

	return root === primary ? [branch, 'HEAD'] : [branch];
}

/** The checkouts the repo's newest reviews left on disk, at most `MAX_REVIEW_DIR_CANDIDATES`. */
async function reviewDirs(repo: Repo, primary: string | null): Promise<string[]> {
	const reviews = (await db.reviews.list())
		.filter((review) => review.repoId === repo.id)
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	const dirs: string[] = [];

	for (const review of reviews.slice(0, MAX_REVIEW_DIR_CANDIDATES)) {
		const path = checkoutOf(review, repo);

		if (path && path !== primary && hasGitObjects(path)) dirs.push(path);
	}

	return dirs;
}

/** The path a review of `repo` was checked out to, or null when it can't be named. */
function checkoutOf(review: Review, repo: Repo): string | null {
	try {
		return reviewCheckoutPath(review, repo);
	} catch {
		return null;
	}
}

/** The commit `name` resolves to in `root`, or null when git cannot resolve it there. */
async function revParse(root: string, name: string, signal: AbortSignal): Promise<string | null> {
	const out = await git(root, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`], signal);
	const sha = out.stdout.trim();

	return out.code === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}
