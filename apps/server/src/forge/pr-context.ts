import type { Provider, Repo } from '@recoder/shared';
import type { GatheredContext, PrRef } from '../review/pipeline/intent/types.js';
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

/** The pull requests a commit landed in, so history can cite why older code is shaped as it is. Empty on failure. */
export async function prsForCommit(repo: Repo, provider: Provider, sha: string, signal: AbortSignal): Promise<PrRef[]> {
	try {
		if (provider === 'local') return await localPrsForCommit(repo.url, sha, signal);

		const slug = parseSlug(repo.url);

		return provider === 'gitlab'
			? await gitlabPrsForCommit(slug, sha, tokenEnv('gitlab', repo.url), signal)
			: await githubPrsForCommit(slug, sha, signal);
	} catch {
		return [];
	}
}
