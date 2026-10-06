import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../../../src/app';
import { listDismissals, recordDismissal } from '../../../src/review/guidelines/learned/dismissals';
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

/** Two findings consolidation split from one line, each with its own claim. */
const split = [
	{
		...finding,
		id: 'stale',
		title: 'Expired entry is served',
		message: '[correctness] A read after expiry returns the old entry',
		claim: {
			trigger: 'a second request reads the entry after it expired',
			executionPath: [],
			consequence: 'the caller gets a stale value',
			violatedContract: 'expired entries are never served'
		}
	},
	{
		...finding,
		id: 'wraps',
		title: 'Index wraps around',
		message: '[correctness] The counter overflows on long loops',
		claim: {
			trigger: 'the loop runs past two billion iterations',
			executionPath: [],
			consequence: 'the counter turns negative and reads out of bounds',
			violatedContract: 'indexes stay inside the array'
		}
	}
];

function savedReview(findings = [finding]) {
	const review = db.reviews.set(testReview({ repoId: 'repo-1', findings }));

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

test('two findings split from one line are dismissed and restored independently', async () => {
	const review = savedReview(split);

	for (const entry of split) {
		expect((await send(`/api/reviews/${review.id}/dismissals`, 'POST', { findingId: entry.id })).status).toBe(200);
	}

	const keys = split.map((entry) => dismissalKey(entry, DIFF));

	expect(keys[0]).not.toBe(keys[1]);

	expect(
		listDismissals('repo-1')
			.map((held) => held.fingerprint)
			.sort()
	).toEqual([...keys].sort());

	expect(await (await send(`/api/reviews/${review.id}/dismissals/stale`, 'DELETE')).json()).toEqual({ restored: true });
	expect(listDismissals('repo-1').map((held) => held.fingerprint)).toEqual([keys[1]]);
});

test('restoring a finding forgets a dismissal stored in the old place-only form', async () => {
	const review = savedReview(split);
	const legacy = dismissalKey(split[0], DIFF).split(':')[0];

	recordDismissal({
		repoId: 'repo-1',
		fingerprint: legacy,
		file: 'src/a.ts',
		category: 'correctness',
		title: 'Expired entry is served',
		dismissedAt: new Date().toISOString()
	});

	expect(await (await send(`/api/reviews/${review.id}/dismissals/stale`, 'DELETE')).json()).toEqual({ restored: true });
	expect(listDismissals('repo-1')).toEqual([]);
});
