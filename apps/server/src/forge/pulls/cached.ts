import { parseUnifiedDiff, type PullDiff, type PullMergeMethod, type Repo } from '@recoder/shared';
import { TtlCache } from '../../util/ttl-cache.js';
import { detectProvider } from '../providers.js';
import { fetchPull } from '../pull-preview.js';
import { githubPullForge } from './github.js';
import { gitlabPullForge } from './gitlab.js';
import { localPullForge } from './local.js';
import { PullHeadMoved, type OpenPulls, type PullEntry, type PullForge } from './status.js';

/** Open pull requests per repository, so the list and the sidebar count share one forge call. */
const listCache = new TtlCache<OpenPulls>(10_000);

/** One pull request, briefly, so the page and its diff tab loading together ask the forge once. */
const viewCache = new TtlCache<PullEntry>(5_000);

/** A repository's allowed merge methods, which change rarely. */
const methodsCache = new TtlCache<PullMergeMethod[]>(5 * 60_000);

/** Parsed diffs by pull request and head commit. A diff at one head never changes, so they last an hour. */
const diffCache = new TtlCache<PullDiff>(60 * 60_000, 50);

/** Times a diff is fetched before a pull request that keeps moving is answered as moved. */
const DIFF_ATTEMPTS = 3;

/** The pull request forge for a repository's provider. */
export function pullForge(repo: Repo): PullForge {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') return localPullForge(repo.url);

	return provider === 'gitlab' ? gitlabPullForge(repo) : githubPullForge(repo.url);
}

/** Open pull requests, from the last ten seconds' answer when there is one. */
export function openPulls(repo: Repo): Promise<OpenPulls> {
	return listCache.get(repo.id, () => pullForge(repo).list());
}

/** Open pull requests straight from the forge; the answer refreshes the cache. */
export function freshOpenPulls(repo: Repo): Promise<OpenPulls> {
	listCache.delete(repo.id);

	return openPulls(repo);
}

/** One pull request in any state, from the last few seconds' answer when there is one. */
export function pullEntry(repo: Repo, n: number): Promise<PullEntry> {
	return viewCache.get(viewKey(repo, n), () => pullForge(repo).view(n));
}

/** One pull request straight from the forge, for a check that must not act on an old answer. */
export function freshPullEntry(repo: Repo, n: number): Promise<PullEntry> {
	viewCache.delete(viewKey(repo, n));

	return pullEntry(repo, n);
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
 * {@link PullHeadMoved}.
 */
async function diffAtSteadyHead(repo: Repo, n: number, headBefore: string): Promise<PullDiff> {
	let expected = headBefore;

	for (let attempt = 1; attempt <= DIFF_ATTEMPTS; attempt++) {
		const fetched = await fetchPull(repo, n);
		const { pull } = await freshPullEntry(repo, n);

		if (fetched.pr.headSha === expected && pull.headSha === expected) {
			return { headSha: expected, files: parseUnifiedDiff(fetched.diff) };
		}

		expected = pull.headSha;
	}

	throw new PullHeadMoved();
}

/** Drop what a comment or a merge made stale, so the next read asks the forge. */
export function forgetPull(repo: Repo, n: number): void {
	viewCache.delete(viewKey(repo, n));
	listCache.delete(repo.id);
}

/** Ends in `/` so dropping pull request 1 by prefix leaves pull request 12 alone. */
function viewKey(repo: Repo, n: number): string {
	return `${repo.id}/${n}/`;
}
