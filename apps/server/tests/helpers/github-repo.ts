import { setToken } from '../../src/forge/tokens';
import { db } from '../../src/store';

/** Track `acme/app` on GitHub with a write token connected; answers the new repository's id. */
export async function trackGithubRepo(): Promise<string> {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();

	await db.repos.set({
		id,
		name: 'acme/app',
		url: 'https://github.com/acme/app',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	setToken('github', 'write-token');

	return id;
}

/** Remove the repository and every review of it. */
export async function forgetRepo(repoId: string): Promise<void> {
	for (const row of await db.reviews.list()) if (row.repoId === repoId) await db.reviews.delete(row.id);
	await db.repos.delete(repoId);
}
