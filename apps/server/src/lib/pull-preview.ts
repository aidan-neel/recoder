import { parseUnifiedDiff, type PullPreview, type Repo } from '@recoder/shared';
import { fetchPullRequest, listPullFiles } from './gh';
import { fetchMergeRequest } from './glab';
import { detectProvider } from './providers';
import { tokenEnv } from './tokens';

/** PR metadata + per-file stats via the provider CLI. No sandbox checkout. */
export async function fetchPullPreview(repo: Repo, prNumber: number): Promise<PullPreview> {
	const provider = repo.provider ?? detectProvider(repo.url);
	const { pr, diff } =
		provider === 'gitlab'
			? await fetchMergeRequest(repo.url, prNumber, { env: tokenEnv('gitlab') })
			: await fetchPullRequest(repo.url, prNumber, { env: tokenEnv('github'), metadataOnly: true });
	return {
		provider,
		pr,
		files: provider === 'github'
			? await listPullFiles(repo.url, prNumber, tokenEnv('github'))
			: parseUnifiedDiff(diff).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }))
	};
}

/** PR metadata + unified diff via the provider CLI (no checkout), for draft sessions. */
export async function fetchPullDiff(repo: Repo, prNumber: number): Promise<{ pr: PullPreview['pr']; diff: string }> {
	const provider = repo.provider ?? detectProvider(repo.url);
	return provider === 'gitlab'
		? fetchMergeRequest(repo.url, prNumber, { env: tokenEnv('gitlab') })
		: fetchPullRequest(repo.url, prNumber, { env: tokenEnv('github') });
}
