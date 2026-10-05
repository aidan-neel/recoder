import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../../../src/app';
import { listDismissals } from '../../../src/review/guidelines/learned/dismissals';
import { dismissalKey } from '../../../src/review/guidelines/learned/finding-key';
import { db, reviewDiffs } from '../../../src/store';
import { DIFF } from '../../review/pipeline/harness-fixtures';
import { testReview } from '../../helpers/review';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-dismiss-route-'));
});

const finding = {
	id: 'finding-1',
	title: 'Drops the old value',
	file: 'src/a.ts',
	line: 1,
	severity: 'warning' as const,
	message: '[correctness] The old value is lost',
	category: 'correctness'
};

function savedReview() {
	const review = db.reviews.set(testReview({ repoId: 'repo-1', findings: [finding] }));

	reviewDiffs.set(review.id, DIFF);

	return review;
}

const send = (path: string, method: string, body?: unknown) =>
	app.request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});

test('dismissing a finding remembers it under the review stored copy, and restoring forgets it', async () => {
	const review = savedReview();

	const dismissed = await send(`/api/reviews/${review.id}/dismissals`, 'POST', {
		findingId: 'finding-1',
		reason: 'on purpose'
	});

	expect(dismissed.status).toBe(200);

	expect(listDismissals('repo-1')).toMatchObject([
		{
			fingerprint: dismissalKey(finding, DIFF),
			file: 'src/a.ts',
			title: 'Drops the old value',
			reason: 'on purpose'
		}
	]);

	expect((await send(`/api/reviews/${review.id}/dismissals/finding-1`, 'DELETE')).status).toBe(200);
	expect(listDismissals('repo-1')).toEqual([]);
});

test('an unknown review or finding is a 404 and remembers nothing', async () => {
	const review = savedReview();

	expect((await send(`/api/reviews/${review.id}/dismissals`, 'POST', { findingId: 'nope' })).status).toBe(404);
	expect((await send(`/api/reviews/${review.id}/dismissals/nope`, 'DELETE')).status).toBe(404);
	expect((await send('/api/reviews/missing/dismissals', 'POST', { findingId: 'finding-1' })).status).toBe(404);
	expect(listDismissals('repo-1')).toEqual([]);
});
