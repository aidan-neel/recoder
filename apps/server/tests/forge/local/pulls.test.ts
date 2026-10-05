import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type { PullPreview, PullRequest, Repo } from '@recoder/shared';
import { app } from '../../../src/app';
import { GhError } from '../../../src/forge/gh';
import { fetchPullPreview } from '../../../src/forge/pull-preview';
import { git } from '../../helpers/git';
import { localForgeFixture } from '../../helpers/local-forge';

test('a local pull reads its head from refs/pull/N/head and counts lines from baseSha, renames included', async () => {
	const { repo } = await localForgeFixture();
	const preview: PullPreview = await fetchPullPreview(repo, 7);

	expect(preview.provider).toBe('local');
	expect(preview.pr.headSha).toBe(git(fileURLToPath(repo.url), ['rev-parse', 'refs/pull/7/head']));
	expect(preview.pr.url).toBe(`${repo.url}#pull/7`);

	expect(preview.files).toEqual([
		{ path: 'a.ts', additions: 2, deletions: 1 },
		{ path: 'new.ts', additions: 0, deletions: 0 }
	]);

	expect([preview.pr.additions, preview.pr.deletions, preview.pr.changedFiles]).toEqual([2, 1, 2]);
});

test('a pull missing from the metadata file is a not-found GhError', async () => {
	const { repo } = await localForgeFixture();
	const error = await fetchPullPreview(repo, 99).catch((err: unknown) => err);

	expect(error).toBeInstanceOf(GhError);
	expect((error as GhError).kind).toBe('not-found');
});

test('a registered local repo lists only its open pulls', async () => {
	const { repo } = await localForgeFixture();

	const created = await app.request('/api/repos', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: repo.name, url: repo.url, provider: 'local' })
	});

	expect(created.status).toBe(201);

	const { id } = (await created.json()) as Repo;
	const pulls = (await (await app.request(`/api/repos/${id}/pulls`)).json()) as PullRequest[];

	expect(pulls.map((pull) => pull.number)).toEqual([7]);

	await app.request(`/api/repos/${id}`, { method: 'DELETE' });
});

test('registering a local repo needs a file:// URL to a git repository', async () => {
	const register = (url: string) =>
		app.request('/api/repos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'x', url, provider: 'local' })
		});

	expect((await register('https://github.com/o/r')).status).toBe(400);
	expect((await register('file:///nonexistent/recoder-repo')).status).toBe(400);
});
