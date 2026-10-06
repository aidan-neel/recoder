import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyTokenUsage, type ReviewContext } from '@recoder/shared';
import { app } from '../../../src/app';
import type { RunTokenCall, StoredMetrics } from '../../../src/models/metrics';
import { db, reviewMetrics } from '../../../src/store';
import { testReview } from '../../helpers/review';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-lifecycle-route-'));
});

const CONTEXT: ReviewContext = {
	units: { 'unit-1': { supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 4 }], omitted: [] } },
	reviewers: [
		{ assignmentId: 'unit-1/correctness', role: 'reviewer', unit: 'unit-1', read: [], cited: [], omitted: [] }
	],
	findings: []
};

test('the review list leaves out each context record, which the single review still serves', async () => {
	const review = db.reviews.set(testReview({ context: CONTEXT }));

	const listed = (await (await app.request('/api/reviews')).json()) as Record<string, unknown>[];

	expect(listed.map((item) => item.id)).toContain(review.id);
	expect(listed.filter((item) => 'context' in item)).toEqual([]);

	expect(await (await app.request(`/api/reviews/${review.id}`)).json()).toMatchObject({ context: CONTEXT });
});

test('the stored metrics route serves the row with its pipeline runs and run-tagged calls, null without one', async () => {
	const review = db.reviews.set(testReview());
	const path = `/api/reviews/${review.id}/metrics/stored`;

	expect(await (await app.request(path)).json()).toBeNull();

	const run = {
		index: 0,
		startedAt: '2026-10-06T19:00:00.000Z',
		orchestrator: 'muse',
		subagent: 'muse',
		lockMisses: 0
	};

	const call: RunTokenCall = {
		id: 'call-1',
		model: 'muse',
		provider: 'opencode',
		scope: 'pipeline',
		status: 'completed',
		usage: emptyTokenUsage(),
		run: 0
	};

	const row: StoredMetrics = {
		id: review.id,
		startedAt: run.startedAt,
		pipelineTracked: true,
		runs: [run],
		calls: [call]
	};

	reviewMetrics.set(row);

	expect(await (await app.request(path)).json()).toEqual(row);
	expect((await app.request('/api/reviews/no-such-review/metrics/stored')).status).toBe(404);
});
