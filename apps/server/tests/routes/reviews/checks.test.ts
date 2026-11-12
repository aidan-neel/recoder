import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../../../src/app';
import { db } from '../../../src/store';
import { testReview } from '../../helpers/review';

const realFetch = globalThis.fetch;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-checks-route-'));
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

/** A GitHub review of PR 7 on a repository added the way the app adds one. */
async function githubReview() {
	const added = await app.request('/api/repos', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'acme/app', url: 'https://github.com/acme/app' })
	});

	const repo = (await added.json()) as { id: string };

	return db.reviews.set(testReview({ repoId: repo.id, prNumber: 7, source: 'github' }));
}

test('a rejected token on the checks read answers its kind, so the app can offer Connections', async () => {
	const review = await githubReview();

	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })) as unknown as typeof fetch;

	const res = await app.request(`/api/reviews/${review.id}/checks`);

	expect(res.status).toBe(502);
	expect(await res.json()).toMatchObject({ kind: 'auth', error: expect.any(String) });
});
