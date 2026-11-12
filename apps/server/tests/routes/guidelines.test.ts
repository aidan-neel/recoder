import { expect, test } from 'bun:test';
import { app } from '../../src/app';
import { db } from '../../src/store';
import { localForgeFixture } from '../helpers/local-forge';

test('proposing guidelines on a local repo says it is read-only instead of asking for a GitHub token', async () => {
	const { repo } = await localForgeFixture();

	await db.repos.set(repo);

	const response = await app.request(`/api/guidelines/repos/${repo.id}/propose`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ content: 'Be kind in reviews.' })
	});

	const body = (await response.json()) as { error: string };

	await db.repos.delete(repo.id);

	expect(response.status).toBe(401);
	expect(body.error).toContain('read-only');
	expect(body.error).not.toContain('GitHub');
});
