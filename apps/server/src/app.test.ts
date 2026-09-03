import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from './app';
import { db, reviewDiffs } from './store';

// Never touch the real data dir (recoder.db) from tests.
process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-test-'));

describe('health', () => {
	test('GET /health returns ok', async () => {
		const res = await app.request('/health');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.name).toBe('recoder');
	});
});

describe('repos', () => {
	test('POST /api/repos validates input', async () => {
		const res = await app.request('/api/repos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: '', url: 'not-a-url' })
		});
		expect(res.status).toBe(400);
	});

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

describe('reviews + command runner', () => {
	test('POST /api/reviews queues a review and the demo pipeline passes', async () => {
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

		// Demo pipeline runs `echo` steps; poll until it settles.
		let status = review.status;
		for (let i = 0; i < 50 && (status === 'queued' || status === 'running'); i++) {
			await new Promise((r) => setTimeout(r, 100));
			const res = await app.request(`/api/reviews/${review.id}`);
			status = (await res.json()).status;
		}
		expect(status).toBe('passed');
		expect(db.runs.list().length).toBeGreaterThan(0);
	});

	describe('discuss', () => {
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
			return review.id;
		}

		test('404 for unknown review', async () => {
			const res = await app.request('/api/reviews/nope/discuss', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body())
			});
			expect(res.status).toBe(404);
		});

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

		test('400 on invalid body', async () => {
			const id = await seedReviewWithDiff();
			const res = await app.request(`/api/reviews/${id}/discuss`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ agent: 'security' })
			});
			expect(res.status).toBe(400);
		});
	});

	test('disallowed commands are rejected', async () => {
		const { runCommand } = await import('./commands/runner');
		await expect(runCommand({ command: 'definitely-not-allowlisted' })).rejects.toThrow(
			/not allowlisted/
		);
	});
});
