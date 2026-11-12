import { parseUnifiedDiff, type PullDiff, type PullMergeMethod, type Repo } from '@recoder/shared';
import { TtlCache } from '../../util/ttl-cache.js';
import { detectProvider } from '../providers.js';
import { fetchPull } from '../pull-preview.js';
import { githubPullForge } from './github.js';
import { gitlabPullForge } from './gitlab.js';
import { localPullForge } from './local.js';
import type { PullEntry, PullForge } from './status.js';

/** Open pull requests per repository, so the list and the sidebar count share one forge call. */
const listCache = new TtlCache<PullEntry[]>(10_000);

/** One pull request, briefly, so the page and its diff tab loading together ask the forge once. */
const viewCache = new TtlCache<PullEntry>(5_000);

/** A repository's allowed merge methods, which change rarely. */
const methodsCache = new TtlCache<PullMergeMethod[]>(5 * 60_000);

/** Parsed diffs by pull request and head commit. A diff at one head never changes, so they last an hour. */
const diffCache = new TtlCache<PullDiff>(60 * 60_000, 50);

/** The pull request forge for a repository's provider. */
export function pullForge(repo: Repo): PullForge {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') return localPullForge(repo.url);

	return provider === 'gitlab' ? gitlabPullForge(repo) : githubPullForge(repo.url);
}

/** Open pull requests, from the last ten seconds' answer when there is one. */
export function openPulls(repo: Repo): Promise<PullEntry[]> {
	return listCache.get(repo.id, () => pullForge(repo).list());
}

/** Open pull requests straight from the forge; the answer refreshes the cache. */
export function freshOpenPulls(repo: Repo): Promise<PullEntry[]> {
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
 * loads its diff (`fetchPull`). When the pull request moved on while the diff
 * loaded, the newer diff is answered but not kept under the older head.
 */
export async function pullDiff(repo: Repo, n: number, headSha: string): Promise<PullDiff> {
	const key = `${viewKey(repo, n)}${headSha}`;

	const diff = await diffCache.get(key, async () => {
		const fetched = await fetchPull(repo, n);

		return { headSha: fetched.pr.headSha, files: parseUnifiedDiff(fetched.diff) };
	});

	if (diff.headSha !== headSha) diffCache.delete(key);

	return diff;
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
