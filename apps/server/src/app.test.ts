import { describe, expect, test } from 'bun:test';
import { app } from './app';
import { db } from './store';

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

	test('disallowed commands are rejected', async () => {
		const { runCommand } = await import('./commands/runner');
		await expect(runCommand({ command: 'definitely-not-allowlisted' })).rejects.toThrow(
			/not allowlisted/
		);
	});
});
