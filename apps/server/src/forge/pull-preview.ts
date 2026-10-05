import { parseUnifiedDiff, type Provider, type PullPreview, type Repo } from '@recoder/shared';
import { fetchPullRequest, listPullFiles, type FetchedPull } from './gh';
import { fetchMergeRequest } from './glab';
import { fetchLocalPull, localPullPreview } from './local/pulls';
import { detectProvider } from './providers';
import { tokenEnv } from './tokens';

/** The command a review shows while PR metadata loads: the CLI call, or the ref a local PR is read from. */
export const PULL_VIEW_COMMANDS: Record<Provider, (n: number) => string> = {
	github: (n) => `gh pr view ${n}`,
	gitlab: (n) => `glab mr view ${n}`,
	local: (n) => `git rev-parse refs/pull/${n}/head`
};

/**
 * PR metadata plus its unified diff from the repo's forge, without a checkout.
 * `metadataOnly` skips the diff where the forge can (GitLab always sends it).
 */
export async function fetchPull(repo: Repo, prNumber: number, opts?: { metadataOnly?: boolean }): Promise<FetchedPull> {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') return fetchLocalPull(repo.url, prNumber, opts);

	return provider === 'gitlab'
		? fetchMergeRequest(repo.url, prNumber, { env: tokenEnv('gitlab', repo.url) })
		: fetchPullRequest(repo.url, prNumber, { env: tokenEnv('github'), metadataOnly: opts?.metadataOnly });
}

/** PR metadata + per-file stats via the provider CLI. No sandbox checkout. */
export async function fetchPullPreview(repo: Repo, prNumber: number): Promise<PullPreview> {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') return { provider, ...(await localPullPreview(repo.url, prNumber)) };

	const { pr, diff } = await fetchPull(repo, prNumber, { metadataOnly: true });

	return {
		provider,
		pr,
		files:
			provider === 'github'
				? await listPullFiles(repo.url, prNumber, tokenEnv('github'))
				: parseUnifiedDiff(diff).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }))
	};
}
