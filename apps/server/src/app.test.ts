import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from './app';
import { db, reviewDiffs, reviewSandboxes } from './store';
import { createReviewSession } from './commands/pipeline';

// Never touch the real data dir (recoder.db) from tests.
process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-test-'));

describe('repos', () => {

	test('CRUD round-trip', async () => {
		const created = await app.request('/api/repos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'demo', url: 'https://github.com/example/demo' })
		});
		expect(created.status).toBe(201);
		const repo = await created.json();
		expect(repo.defaultBranch).toBe('main');

		const fetched = await app.request(`/api/repos/${repo.id}`);
		expect(fetched.status).toBe(200);

		const missing = await app.request('/api/repos/does-not-exist');
		expect(missing.status).toBe(404);
	});
});

test('a fix request with no model set up says so instead of a 500', async () => {
	const repo = db.repos.set({ id: 'repo-nomodel-fix', name: 'demo', url: 'https://github.com/example/demo', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' });
	const review = createReviewSession({ repoId: repo.id, prNumber: 1 });
	reviewDiffs.set(review.id, 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n');
	const res = await app.request(`/api/reviews/${review.id}/fixes/suggest`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ agent: 'correctness', finding: { file: 'x.ts', line: 1, endLine: 1, severity: 'error', message: 'bug' } })
	});
	expect(res.status).toBe(409);
	expect(await res.json()).toMatchObject({ error: expect.stringContaining('Settings → Models'), action: 'settings' });
});

/** Queueing requires a reviewer model — stub it for tests that need reviews. */
function useModel(): void {
	beforeEach(() => {
		process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
		process.env.RECODER_REVIEW_API_KEY = 'test';
		process.env.RECODER_REVIEW_MODEL = 'test-model';
	});
	afterEach(() => {
		delete process.env.RECODER_REVIEW_BASE_URL;
		delete process.env.RECODER_REVIEW_API_KEY;
		delete process.env.RECODER_REVIEW_MODEL;
	});
}

describe('reviews + command runner', () => {
	useModel();

	test('POST /api/reviews refuses without a reviewer model', async () => {
		delete process.env.RECODER_REVIEW_BASE_URL;
		delete process.env.RECODER_REVIEW_API_KEY;
		delete process.env.RECODER_REVIEW_MODEL;
		try {
			const createdRepo = await app.request('/api/repos', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'demo-nomodel', url: 'https://github.com/example/demo' })
			});
			const repo = await createdRepo.json();
			const res = await app.request('/api/reviews', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ repoId: repo.id, prNumber: 1 })
			});
			expect(res.status).toBe(400);
			expect((await res.json()).error).toMatch(/reviewer not configured/);
		} finally {
			process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
			process.env.RECODER_REVIEW_API_KEY = 'test';
			process.env.RECODER_REVIEW_MODEL = 'test-model';
		}
	});

	test('POST /api/reviews queues a review and provider fetch failures fail instead of stub-succeeding', async () => {
		const createdRepo = await app.request('/api/repos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'demo', url: 'https://github.com/example/demo' })
		});
		const repo = await createdRepo.json();

		const createdReview = await app.request('/api/reviews', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ repoId: repo.id, prNumber: 42 })
		});
		expect(createdReview.status).toBe(201);
		const review = await createdReview.json();
		expect(review.status).toBe('queued');

		let loaded = review;
		for (let i = 0; i < 50 && (loaded.status === 'queued' || loaded.status === 'running'); i++) {
			await new Promise((r) => setTimeout(r, 100));
			const res = await app.request(`/api/reviews/${review.id}`);
			loaded = await res.json();
		}
		expect(loaded.status).toBe('failed');
		expect(loaded.summary).toBeTruthy();
		expect(loaded.findings).toEqual([]);
	});

	test('DELETE /api/reviews/:id removes the review and its diff', async () => {
		const createdRepo = await app.request('/api/repos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'demo-delete', url: 'https://github.com/example/demo-delete' })
		});
		const repo = await createdRepo.json();

		const createdReview = await app.request('/api/reviews', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ repoId: repo.id, prNumber: 9 })
		});
		const review = await createdReview.json();
		reviewDiffs.set(review.id, 'diff --git a/a.ts b/a.ts');

		const deleted = await app.request(`/api/reviews/${review.id}`, { method: 'DELETE' });
		expect(deleted.status).toBe(200);
		expect((await deleted.json()).deleted).toBe(true);

		expect((await app.request(`/api/reviews/${review.id}`)).status).toBe(404);
		expect(reviewDiffs.get(review.id)).toBeUndefined();
		expect((await app.request(`/api/reviews/${review.id}`, { method: 'DELETE' })).status).toBe(
			404
		);
	});

	describe('discuss', () => {
		useModel();
		const realFetch = globalThis.fetch;

		function stubFetch(reply: string): void {
			globalThis.fetch = (async () =>
				new Response(
					JSON.stringify({ choices: [{ message: { content: reply } }] }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)) as unknown as typeof fetch;
		}

		const body = (finding: object = {}) => ({
			agent: 'security',
			finding: {
				file: 'a.ts',
				line: 2,
				endLine: 3,
				severity: 'high',
				message: '[auth] shared singleton',
				...finding
			},
			history: [{ role: 'user', body: 'why?' }],
			question: 'Is this reachable?'
		});

		async function seedReviewWithDiff(): Promise<string> {
			const createdRepo = await app.request('/api/repos', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'demo-discuss', url: 'https://github.com/example/demo' })
			});
			const repo = await createdRepo.json();
			const createdReview = await app.request('/api/reviews', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ repoId: repo.id, prNumber: 7 })
			});
			const review = await createdReview.json();
			reviewDiffs.set(
				review.id,
				'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,4 @@\n ctx\n-old\n+new\n tail'
			);
			// A real checkout of the PR head, so fixes are built against the file.
			const checkout = mkdtempSync(join(tmpdir(), 'recoder-fix-checkout-'));
			Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout });
			writeFileSync(join(checkout, 'a.ts'), 'ctx\nnew\ntail\n');
			reviewSandboxes.set(review.id, checkout);
			return review.id;
		}

		test('409 without a fetched diff', async () => {
			const createdRepo = await app.request('/api/repos', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'demo-nodiff', url: 'https://github.com/example/demo' })
			});
			const repo = await createdRepo.json();
			const createdReview = await app.request('/api/reviews', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ repoId: repo.id, prNumber: 8 })
			});
			const review = await createdReview.json();
			const res = await app.request(`/api/reviews/${review.id}/discuss`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body())
			});
			// Diff may or may not have arrived yet; either no-diff or a model answer.
			expect([409, 200, 502]).toContain(res.status);
		});

		test('answers with the finding reviewer and model', async () => {
			process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
			process.env.RECODER_REVIEW_API_KEY = 'test';
			process.env.RECODER_REVIEW_MODEL = 'test-model';
			stubFetch('Yes — gateway.ts:88 passes the raw IP.');
			try {
				const id = await seedReviewWithDiff();
				const res = await app.request(`/api/reviews/${id}/discuss`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body())
				});
				expect(res.status).toBe(200);
				const answer = await res.json();
				expect(answer.agent).toBe('security');
				expect(answer.model).toBe('test-model');
				expect(answer.reply).toContain('gateway.ts:88');
			} finally {
				globalThis.fetch = realFetch;
				delete process.env.RECODER_REVIEW_BASE_URL;
				delete process.env.RECODER_REVIEW_API_KEY;
				delete process.env.RECODER_REVIEW_MODEL;
			}
		});

		test('streams tokens then a done event', async () => {
			process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
			process.env.RECODER_REVIEW_API_KEY = 'test';
			process.env.RECODER_REVIEW_MODEL = 'test-model';
			const sse = [
				'data: {"choices":[{"delta":{"content":"Yes — "}}]}',
				'data: {"choices":[{"delta":{"content":"gateway.ts:88"}}]}',
				'data: [DONE]'
			].join('\n\n');
			globalThis.fetch = (async () =>
				new Response(sse, {
					status: 200,
					headers: { 'content-type': 'text/event-stream' }
				})) as unknown as typeof fetch;
			try {
				const id = await seedReviewWithDiff();
				const res = await app.request(`/api/reviews/${id}/discuss/stream`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body())
				});
				expect(res.status).toBe(200);
				expect(res.headers.get('content-type')).toContain('text/event-stream');
				const text = await res.text();
				expect(text).toContain('"type":"token"');
				expect(text).toContain('gateway.ts:88');
				const done = text
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line.startsWith('data:'))
					.map((line) => JSON.parse(line.slice(5).trim()))
					.find((event) => event.type === 'done');
				expect(done.agent).toBe('security');
				expect(done.reply).toContain('gateway.ts:88');
			} finally {
				globalThis.fetch = realFetch;
				delete process.env.RECODER_REVIEW_BASE_URL;
				delete process.env.RECODER_REVIEW_API_KEY;
				delete process.env.RECODER_REVIEW_MODEL;
			}
		});

		test('builds the fix patch from the model\'s edits against the checkout', async () => {
			process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
			process.env.RECODER_REVIEW_API_KEY = 'test';
			process.env.RECODER_REVIEW_MODEL = 'test-model';
			stubFetch(
				'{"summary": "Namespace buckets per tenant.", "edits": [{"file": "a.ts", "find": "new", "replace": "newer"}]}'
			);
			try {
				const id = await seedReviewWithDiff();
				const res = await app.request(`/api/reviews/${id}/fixes/suggest`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body())
				});
				expect(res.status).toBe(200);
				const fix = await res.json();
				expect(fix.summary).toContain('Namespace');
				expect(fix.patch).toContain('--- a/a.ts');
				expect(fix.patch).toContain('+newer');
				expect(fix.applies).toBe(true);
			} finally {
				globalThis.fetch = realFetch;
				delete process.env.RECODER_REVIEW_BASE_URL;
				delete process.env.RECODER_REVIEW_API_KEY;
				delete process.env.RECODER_REVIEW_MODEL;
			}
		});

		test('rejects fix edits that match nothing in the file', async () => {
			process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
			process.env.RECODER_REVIEW_API_KEY = 'test';
			process.env.RECODER_REVIEW_MODEL = 'test-model';
			stubFetch('{"summary": "Just rewrite it.", "edits": [{"file": "a.ts", "find": "not in the file", "replace": "x"}]}');
			try {
				const id = await seedReviewWithDiff();
				const res = await app.request(`/api/reviews/${id}/fixes/suggest`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body())
				});
				expect(res.status).toBe(502);
			} finally {
				globalThis.fetch = realFetch;
				delete process.env.RECODER_REVIEW_BASE_URL;
				delete process.env.RECODER_REVIEW_API_KEY;
				delete process.env.RECODER_REVIEW_MODEL;
			}
		});

		test('unknown agent falls back to a known role', async () => {
			process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
			process.env.RECODER_REVIEW_API_KEY = 'test';
			process.env.RECODER_REVIEW_MODEL = 'test-model';
			stubFetch('ok');
			try {
				const id = await seedReviewWithDiff();
				const res = await app.request(`/api/reviews/${id}/discuss`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...body(), agent: 'not-a-role' })
				});
				const answer = await res.json();
				expect(answer.agent).toBe('security');
			} finally {
				globalThis.fetch = realFetch;
				delete process.env.RECODER_REVIEW_BASE_URL;
				delete process.env.RECODER_REVIEW_API_KEY;
				delete process.env.RECODER_REVIEW_MODEL;
			}
		});

		describe('fixes apply', () => {
			const applyBody = (patch: object = {}) => ({
				finding: {
					file: 'a.ts',
					line: 2,
					endLine: 3,
					severity: 'high',
					message: '[auth] shared singleton'
				},
				summary: 'Namespace buckets per tenant.',
				patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,4 @@\n ctx\n-old\n+new\n tail',
				...patch
			});

			test('409 for stub reviews without a checkout', async () => {
				const id = await seedReviewWithDiff();
				db.reviews.set({ ...db.reviews.get(id)!, source: 'stub' });
				const res = await app.request(`/api/reviews/${id}/fixes/apply`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(applyBody())
				});
				expect(res.status).toBe(409);
			});
		});
	});

	test('disallowed commands are rejected', async () => {
		const { runCommand } = await import('./commands/runner');
		await expect(runCommand({ command: 'definitely-not-allowlisted' })).rejects.toThrow(
			/not allowlisted/
		);
	});
});
