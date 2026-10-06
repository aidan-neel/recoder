import { afterAll, expect, test } from 'bun:test';
import { runReview, stopReviews } from '../../src/eval/run-review';

/** Start requests the fake server has received, and the reviews it was asked to cancel. */
const started: string[] = [];
const cancelled: string[] = [];

/** A Recoder server that takes 200ms to answer a start request. */
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname;

		if (request.method === 'POST' && path === '/api/reviews') {
			const id = `review-${started.length + 1}`;

			started.push(id);

			await Bun.sleep(200);

			return Response.json({ id, status: 'queued' });
		}

		const cancel = path.match(/^\/api\/reviews\/([^/]+)\/cancel$/);

		if (cancel) {
			cancelled.push(cancel[1]!);

			return Response.json({ cancelled: true });
		}

		return Response.json({ error: 'not found' }, { status: 404 });
	}
});

const base = `http://localhost:${server.port}`;

afterAll(() => {
	void server.stop(true);
});

test('a stop that arrives while a start request is pending cancels that review once its id is known', async () => {
	const target = { base, timeoutMs: 60_000, baselineCache: true, inPlace: false };

	void runReview(target, { repoId: 'repo', pr: 1, index: 1, label: 'pr 1' });
	await Bun.sleep(50);
	expect(cancelled).toEqual([]);

	await stopReviews(base);

	expect(started).toHaveLength(1);
	expect(cancelled).toEqual(['review-1']);

	void runReview(target, { repoId: 'repo', pr: 2, index: 1, label: 'pr 2' });
	await Bun.sleep(300);
	expect(started).toHaveLength(1);
});
