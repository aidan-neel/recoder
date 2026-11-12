import type { Provider, Repo } from '@recoder/shared';
import type { GatheredContext, PrRef } from '../review/pipeline/intent/types.js';
import { readFact, writeFact } from '../util/fact-cache.js';
import { emptyContext, gatherWith } from './context/gather.js';
import { githubAdapter, githubPrsForCommit } from './context/github.js';
import { gitlabAdapter, gitlabPrsForCommit } from './context/gitlab.js';
import { localAdapter, localPrsForCommit } from './local/context.js';
import { parseSlug } from './providers.js';
import { tokenEnv } from './tokens.js';

/**
 * Why a pull request exists, gathered from its host before the review: the
 * description, linked and mentioned issues, the discussion, its commits, the
 * PRs stacked around it and past Recoder reviews, plus who is on it. Best
 * effort: a failure, or a signal aborted before the end, yields an empty context
 * rather than a partial one, so two runs never see different halves.
 */
export async function gatherChangeContext(
	repo: Repo,
	prNumber: number,
	provider: Provider,
	signal: AbortSignal
): Promise<GatheredContext> {
	try {
		const slug = parseSlug(repo.url);

		const adapter =
			provider === 'local'
				? localAdapter(repo.url, slug, prNumber, signal)
				: provider === 'gitlab'
					? gitlabAdapter(slug, prNumber, tokenEnv('gitlab', repo.url), signal)
					: githubAdapter(slug, prNumber, signal);

		const context = await gatherWith(adapter, repo.id, signal);

		return signal.aborted ? emptyContext() : context;
	} catch {
		return emptyContext();
	}
}

/** Where the commit-to-PR answers are kept across reviews. */
const COMMIT_PRS = 'commit-prs';

/** A full object id; `HEAD` or a short sha can point somewhere else tomorrow, so its answer is never kept. */
const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * The pull requests a commit landed in, so history can cite why older code is
 * shaped as it is. Empty on failure. An answer whose every PR is merged is
 * kept: which PR brought a commit in never changes after the merge, so later
 * reviews of any PR in the repository read it back instead of asking the host.
 */
export async function prsForCommit(repo: Repo, provider: Provider, sha: string, signal: AbortSignal): Promise<PrRef[]> {
	const key = `${repo.id}\0${sha}`;
	const keepable = FULL_SHA.test(sha);
	const known = keepable ? readFact<PrRef[]>(COMMIT_PRS, key) : null;

	if (known) return known;

	const found = await askHostForPrs(repo, provider, sha, signal);

	if (keepable && found.length && found.every((ref) => ref.state === 'merged')) writeFact(COMMIT_PRS, key, found);

	return found;
}

async function askHostForPrs(repo: Repo, provider: Provider, sha: string, signal: AbortSignal): Promise<PrRef[]> {
	try {
		const slug = parseSlug(repo.url);

		if (provider === 'local') return await localPrsForCommit(repo.url, slug, sha, signal);

		return provider === 'gitlab'
			? await gitlabPrsForCommit(slug, sha, tokenEnv('gitlab', repo.url), signal)
			: await githubPrsForCommit(slug, sha, signal);
	} catch {
		return [];
	}
}
