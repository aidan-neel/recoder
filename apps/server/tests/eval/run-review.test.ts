import { afterAll, expect, spyOn, test } from 'bun:test';
import { readReviewer, runReview, stopReviews } from '../../src/eval/run-review';

/** Start requests the fake server has received, and the reviews it was asked to cancel. */
const started: string[] = [];
const cancelled: string[] = [];

/** The metrics row the server stores for `review-stored`: one pipeline run locked on muse that called luna too. */
const STORED = {
	id: 'review-stored',
	startedAt: '2026-10-06T19:00:00.000Z',
	pipelineTracked: true,
	runs: [{ index: 0, startedAt: '2026-10-06T19:00:00.000Z', orchestrator: 'muse', subagent: 'muse', lockMisses: 0 }],
	calls: ['muse', 'luna'].map((model) => ({
		id: model,
		model,
		scope: 'pipeline',
		status: 'completed',
		run: 0,
		usage: {}
	}))
};

/** Settled once the fake server has a start request, so a test can act while the request is still pending. */
const startReceived = Promise.withResolvers<void>();

/** Settled by a test to let the fake server answer the start requests it holds. */
const startAnswered = Promise.withResolvers<void>();

/**
 * A Recoder server that holds a start request until `startAnswered` settles, and serves stored metrics for
 * `review-stored` only.
 */
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname;

		if (request.method === 'POST' && path === '/api/reviews') {
			const id = `review-${started.length + 1}`;

			started.push(id);
			startReceived.resolve();

			await startAnswered.promise;

			return Response.json({ id, status: 'queued' });
		}

		if (path === '/api/reviews/review-stored/metrics/stored') return Response.json(STORED);

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
	await startReceived.promise;
	expect(cancelled).toEqual([]);

	const stopped = stopReviews(base);

	startAnswered.resolve();
	await stopped;

	expect(started).toHaveLength(1);
	expect(cancelled).toEqual(['review-1']);

	let startsAfterStop = 0;

	void runReview(target, { repoId: 'repo', pr: 2, index: 1, label: 'pr 2' }, () => {
		startsAfterStop++;

		return new Promise<never>(() => undefined);
	});

	expect(startsAfterStop).toBe(0);
});

test("a finished review's reviewer is read from the server's stored metrics; a server without the route records none", async () => {
	expect(await readReviewer(base, 'review-stored', ['muse', 'muse'])).toMatchObject({
		orchestrator: { model: 'muse' },
		calledModels: ['luna', 'muse'],
		verdict: 'MIXED',
		mixed: true
	});

	const warn = spyOn(console, 'warn').mockImplementation(() => undefined);

	expect(await readReviewer(base, 'review-elsewhere', ['muse', 'muse'])).toBeUndefined();
	expect(warn).toHaveBeenCalledTimes(1);
	warn.mockRestore();
});
