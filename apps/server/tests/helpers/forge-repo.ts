import type { Repo } from '@recoder/shared';
import { setToken } from '../../src/forge/tokens';
import { db } from '../../src/store';

/** Track `acme/app` on GitHub with a write token connected; answers the new repository's id. */
export function trackGithubRepo(): Promise<string> {
	return trackRepo('github', 'https://github.com/acme/app');
}

/** Track `team/app` on the GitLab at git.acme.dev with a write token connected; answers the new repository's id. */
export function trackGitlabRepo(): Promise<string> {
	return trackRepo('gitlab', 'https://git.acme.dev/team/app');
}

async function trackRepo(provider: 'github' | 'gitlab', url: string): Promise<string> {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();

	const repo: Repo = {
		id,
		name: new URL(url).pathname.slice(1),
		url,
		provider,
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	};

	await db.repos.set(repo);
	setToken(provider, 'write-token');

	return id;
}

/** Remove the repository and every review of it. */
export async function forgetRepo(repoId: string): Promise<void> {
	for (const row of await db.reviews.list()) if (row.repoId === repoId) await db.reviews.delete(row.id);
	await db.repos.delete(repoId);
}
