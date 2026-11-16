import { GUIDELINES_PATH, type Repo, type RepoGuidelines } from '@recoder/shared';
import { repoFileHost, type RepoFileHost } from '../../forge/repo-files';
import { TtlCache } from '../../util/ttl-cache';
import { readRepoGuidelinesFile } from './repo-layer';

/** Branches Recoder opens for guideline changes; one pending change per repo. */
export const GUIDELINES_BRANCH_PREFIX = 'recoder/review-guidelines-';

/** External edits become visible within ten seconds; a proposal made here invalidates its in-flight reads too. */
const overviews = new TtlCache<Omit<RepoGuidelines, 'canPropose'>>(10_000);

export function forgetRepoOverview(repoId: string): void {
	overviews.delete(`${repoId}/`);
}

/** One page's reads share its forge calls. Permissions are checked against today's credentials on every read. */
export async function repoOverview(repo: Repo, host: RepoFileHost = repoFileHost(repo)): Promise<RepoGuidelines> {
	const key = `${repo.id}/${JSON.stringify([repo.url, repo.provider, repo.defaultBranch])}`;

	const body = await overviews.get(key, async () => {
		const [head, pending] = await Promise.all([
			host.defaultBranch(),
			host.findPending(GUIDELINES_BRANCH_PREFIX).catch(() => null)
		]);

		const [file, pendingFile] = await Promise.all([
			readRepoGuidelinesFile(host, head.branch),
			pending ? readRepoGuidelinesFile(host, pending.branch).catch(() => null) : null
		]);

		return {
			repoId: repo.id,
			path: file?.path ?? pendingFile?.path ?? GUIDELINES_PATH,
			ref: head.branch,
			sha: head.sha || null,
			content: file?.content ?? null,
			pending: pending ? { ...pending, content: pendingFile?.content ?? null } : null
		};
	});

	return { ...body, canPropose: host.canWrite() };
}
