import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewContext } from '@recoder/shared';
import { app } from '../../../src/app';
import { db } from '../../../src/store';
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
