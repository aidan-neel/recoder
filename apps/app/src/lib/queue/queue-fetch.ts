import type { ProgressSummaries, PullRequest, Repo, ReviewListItem } from '@recoder/shared';

import { failureKind, failureText, type FailureKind } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { readRepos } from '../review/repo-names';
import { rememberCount } from '../settings/last-counts';

/** A repository whose pull requests did not load on the last refresh, and why. */
export interface MissingRepo {
	name: string;
	provider: Repo['provider'];
	kind: FailureKind;
	/** The failure in plain words. */
	text: string;
}

/** Everything one refresh of the queue read, taken whole so the page changes once. */
export interface QueueData {
	repos: Repo[];
	/** Each repository's open pull requests, in the order of `repos`; null where they did not load. */
	pulls: (PullRequest[] | null)[];
	missing: MissingRepo[];
	reviews: ReviewListItem[];
	/** Running reviews' task counts; null when they did not load, so the last ones stay. */
	progress: ProgressSummaries | null;
}

/**
 * How long a repository's pull requests are reused. The review list and the
 * progress refresh every few seconds; the forge is asked at most this often.
 */
const PULLS_MS = 60_000;

/** The first wait after a failed load... */
const RETRY_FIRST_MS = 1000;

/** ...doubling up to this. */
const RETRY_MAX_MS = 15_000;

/** Each repository's last pull request request, by id, with when it was asked. */
const pullsCache = new Map<string, { at: number; pulls: Promise<PullRequest[]> }>();

/** Marks a promise as handled while it waits to be awaited, so a rejection that lands first is not reported as unhandled. */
function quiet<T>(promise: Promise<T>): Promise<T> {
	promise.catch(() => undefined);

	return promise;
}

/**
 * A repository's open pull requests: the last request while it is younger
 * than {@link PULLS_MS}, else a new one. `force` always asks again. A failed
 * request is dropped at once, so the next refresh asks again; the server
 * keeps a forge's refusal for a minute itself.
 */
function pullsOf(repoId: string, force: boolean, now: number): Promise<PullRequest[]> {
	const cached = pullsCache.get(repoId);

	if (cached && !force && now - cached.at < PULLS_MS) return cached.pulls;

	const pulls = quiet(reviewsApi.pulls(repoId));
	const forget = () => pullsCache.get(repoId)?.pulls === pulls && pullsCache.delete(repoId);

	pullsCache.set(repoId, { at: now, pulls });
	pulls.catch(forget);

	return pulls;
}

/** Forgets every repository's pull requests, so the next refresh asks every forge again. */
export function forgetPulls(): void {
	pullsCache.clear();
}

/** A pull request as the queue keeps it: the description is left out, since no row shows it and it can run long. */
function listPull({ body: _body, ...pull }: PullRequest): PullRequest {
	return pull;
}

/** One repository's pull requests, or what failed, with the server's reason and its kind. */
async function settle(repo: Repo, pulls: Promise<PullRequest[]>): Promise<PullRequest[] | MissingRepo> {
	try {
		return (await pulls).map(listPull);
	} catch (error) {
		return { name: repo.name, provider: repo.provider, kind: failureKind(error), text: failureText(error) };
	}
}

/**
 * Reads the queue. The pull requests of `known` (the repositories the last
 * load found) start at once, beside the repository list, the review list and
 * the progress; any new repository's start as soon as the list arrives. A
 * request started early is the one the list's repository waits on, even when
 * it already failed and left the cache, so no repository is asked twice. It
 * resolves once every request has answered or run out of time, and rejects
 * when the repositories or the reviews fail. One repository's pull requests
 * failing costs only its rows. The number of tracked repositories is kept,
 * so a first visit to Settings draws that many rows. Their names are kept
 * too (`readRepos`), so a review opened next does not ask for them again.
 */
export async function fetchQueue(known: Repo[], force: boolean): Promise<QueueData> {
	const now = Date.now();
	const early = new Map(known.map((repo) => [repo.id, pullsOf(repo.id, force, now)]));
	const lists = quiet(Promise.all([reviewsApi.reviewList(), reviewsApi.progress().catch(() => null)]));
	const repos = await readRepos();

	rememberCount('repos', repos.length);

	const [settled, [reviews, progress]] = await Promise.all([
		Promise.all(repos.map((repo) => settle(repo, early.get(repo.id) ?? pullsOf(repo.id, force, now)))),
		lists
	]);

	return {
		repos,
		pulls: settled.map((result) => (Array.isArray(result) ? result : null)),
		missing: settled.filter((result): result is MissingRepo => !Array.isArray(result)),
		reviews,
		progress
	};
}

/** The wait before the next try after `failures` failed loads in a row: 1, 2, 4 and 8 seconds, then 15. */
export function retryDelay(failures: number): number {
	return Math.min(RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}
