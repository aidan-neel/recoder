import {
	parseUnifiedDiff,
	type PrCheck,
	type PullComment,
	type PullCommit,
	type PullDiff,
	type PullMergeMethod,
	type PullRequest,
	type Repo
} from '@recoder/shared';
import { TtlCache } from '../../util/ttl-cache.js';
import { fetchChecks } from '../checks.js';
import { detectProvider } from '../providers.js';
import { fetchPull } from '../pull-preview.js';
import { githubPullForge } from './github.js';
import { gitlabPullForge } from './gitlab.js';
import { localPullForge } from './local.js';
import { recordPullState } from './pull-states.js';
import { PullHeadMoved, type OpenPulls, type PullEntry, type PullForge } from './status.js';

/** One page of open pull requests per repository, so the list and the sidebar count share one forge call. */
const listCache = new TtlCache<OpenPulls>(10_000);

/** One pull request, briefly, so the page and its diff tab loading together ask the forge once. */
const viewCache = new TtlCache<PullEntry>(5_000);

/** One pull request's head commit, so the diff route's ETag check costs a light read instead of a full view. */
const headCache = new TtlCache<string>(5_000);

/** A pull request's commits by head commit; commits at one head never change, so they last an hour. */
const commitsCache = new TtlCache<PullCommit[]>(60 * 60_000, 100);

/** The head commit's checks, briefly; the page polls them anyway while one runs. */
const checksCache = new TtlCache<PrCheck[]>(10_000);

/** The pull request's conversation, briefly; posting a comment drops it. */
const conversationCache = new TtlCache<PullComment[]>(10_000);

/** A repository's allowed merge methods, which change rarely. */
const methodsCache = new TtlCache<PullMergeMethod[]>(5 * 60_000);

/** Parsed diffs by pull request and head commit. A diff at one head never changes, so they last an hour. */
const diffCache = new TtlCache<PullDiff>(60 * 60_000, 50);

/** Times a diff is fetched before a pull request that keeps moving is answered as moved. */
const DIFF_ATTEMPTS = 3;

/** How old a pull request list may be and still answer at once while it is read again behind it. */
const LIST_STALE_MS = 120_000;

/** The pull request forge for a repository's provider. */
export function pullForge(repo: Repo): PullForge {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') return localPullForge(repo.url);

	return provider === 'gitlab' ? gitlabPullForge(repo) : githubPullForge(repo.url);
}

/** The forge's answer to `view`, with the pull request's state remembered for the sweep. */
async function readEntry(repo: Repo, n: number): Promise<PullEntry> {
	const entry = await pullForge(repo).view(n);

	await recordPullState(repo.id, n, entry.status.state);

	return entry;
}

/** A page straight from the forge, with each pull request's state remembered for the sweep. */
async function readList(repo: Repo, after: string | null): Promise<OpenPulls> {
	const page = await pullForge(repo).list(after);

	await Promise.all(page.entries.map((entry) => recordPullState(repo.id, entry.pull.number, 'open')));

	return page;
}

/**
 * A page of open pull requests. The last answer is served while a fresh one
 * loads behind it, so returning to the list paints at once; only a stale
 * answer older than {@link LIST_STALE_MS} waits on the forge. `after` null is
 * the first page.
 */
export function openPulls(repo: Repo, after: string | null = null): Promise<OpenPulls> {
	return listCache.stale(pageKey(repo, after), () => readList(repo, after), LIST_STALE_MS);
}

/** A page of open pull requests straight from the forge; the answer refreshes the cache. */
export function freshOpenPulls(repo: Repo, after: string | null = null): Promise<OpenPulls> {
	listCache.delete(pageKey(repo, after));

	return readList(repo, after);
}

/** One pull request in any state, from the last few seconds' answer when there is one. */
export function pullEntry(repo: Repo, n: number): Promise<PullEntry> {
	return viewCache.get(viewKey(repo, n), () => readEntry(repo, n));
}

/**
 * One pull request as it was at its last read, at once, with a fresh read
 * started behind it; a read older than `maxAgeMs` waits for the fresh one.
 * For callers the page's own polling covers: mergeability and checks are
 * asked again while they are open or running.
 */
export function pullEntryStale(repo: Repo, n: number, maxAgeMs: number): Promise<PullEntry> {
	return viewCache.stale(viewKey(repo, n), () => readEntry(repo, n), maxAgeMs);
}

/** One pull request straight from the forge, for a check that must not act on an old answer. */
export function freshPullEntry(repo: Repo, n: number): Promise<PullEntry> {
	viewCache.delete(viewKey(repo, n));

	return pullEntry(repo, n);
}

/** The pull request's head commit, from the last few seconds' read when there is one. */
export function pullHead(repo: Repo, n: number): Promise<string> {
	return headCache.get(`${viewKey(repo, n)}head`, () => pullForge(repo).head(n));
}

/** The pull request's commits, by head: a head's commits never change. */
export function pullCommits(repo: Repo, pull: PullRequest): Promise<PullCommit[]> {
	return commitsCache.get(`${viewKey(repo, pull.number)}commits/${pull.headSha}`, () => pullForge(repo).commits(pull));
}

/** The head commit's checks, shared across the page's polls and tabs. */
export function pullChecks(repo: Repo, pull: PullRequest): Promise<PrCheck[]> {
	return checksCache.get(`${viewKey(repo, pull.number)}checks/${pull.headSha}`, () => fetchChecks(repo, pull.headSha));
}

/** The pull request's conversation, from the last few seconds' read when there is one. */
export function pullConversation(repo: Repo, pull: PullRequest): Promise<PullComment[]> {
	return conversationCache.get(`${viewKey(repo, pull.number)}conversation`, () => pullForge(repo).conversation(pull));
}

export function mergeMethods(repo: Repo): Promise<PullMergeMethod[]> {
	return methodsCache.get(repo.id, () => pullForge(repo).mergeMethods());
}

/**
 * The pull request's whole diff at `headSha`, shared with how a draft review
 * loads its diff (`fetchPull`). `headSha` must have been read from the forge
 * before this call. When the pull request moved on, the newer diff is
 * answered but not kept under the older head.
 */
export async function pullDiff(repo: Repo, n: number, headSha: string): Promise<PullDiff> {
	const key = `${viewKey(repo, n)}${headSha}`;
	const diff = await diffCache.get(key, () => diffAtSteadyHead(repo, n, headSha));

	if (diff.headSha !== headSha) diffCache.delete(key);

	return diff;
}

/**
 * The diff labelled with the head it was taken at. No forge pins the diff it
 * sends to a commit, so a push while it loads would put newer files under the
 * older head. The head is read before and after the fetch, and the diff is
 * kept only when both reads and the fetch name the same commit; otherwise it
 * is fetched again from the newer head, a few times, before
 * {@link PullHeadMoved}. The verification asks only for the head, not the
 * pull request's whole status.
 */
async function diffAtSteadyHead(repo: Repo, n: number, headBefore: string): Promise<PullDiff> {
	let expected = headBefore;

	for (let attempt = 1; attempt <= DIFF_ATTEMPTS; attempt++) {
		const fetched = await fetchPull(repo, n);
		const head = await pullHead(repo, n);

		if (fetched.pr.headSha === expected && head === expected) {
			return { headSha: expected, files: parseUnifiedDiff(fetched.diff) };
		}

		expected = head;
	}

	throw new PullHeadMoved();
}

/** Drop what a comment or a merge made stale, so the next read asks the forge. */
export function forgetPull(repo: Repo, n: number): void {
	const key = viewKey(repo, n);

	viewCache.delete(key);
	headCache.delete(key);
	commitsCache.delete(key);
	checksCache.delete(key);
	conversationCache.delete(key);
	listCache.delete(pageKey(repo, null));
}

function pageKey(repo: Repo, after: string | null): string {
	return after === null ? repo.id : `${repo.id}/after/${after}`;
}

/** Ends in `/` so dropping pull request 1 by prefix leaves pull request 12 alone. */
function viewKey(repo: Repo, n: number): string {
	return `${repo.id}/${n}/`;
}
