import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { reviewListItem, type Review } from '@recoder/shared';
import { db, closeStore } from '../../src/store';
import { serverDataDir } from '../../src/util/data-dir';
import { testReview } from '../helpers/review';
import { useTempStore } from '../helpers/temp-store';

const { track } = useTempStore('recoder-review-list-');

test('a summary reflects transactional updates and replacement writes', async () => {
	const review = testReview();

	track(review.id);
	await db.reviews.set(review);
	expect(await db.reviews.summaries()).toEqual([reviewListItem(review)]);

	const updated = await db.reviews.update(review.id, (current) => ({ ...current!, summary: 'Decided' }));

	expect(await db.reviews.summaries()).toEqual([reviewListItem(updated!)]);
	await db.reviews.set({ ...review, status: 'failed' });
	expect((await db.reviews.summaries())[0].status).toBe('failed');
});

/** Stores a review with its summary, closes the store, and runs `write` on another connection to the same file. */
async function writeElsewhere(write: (other: Database, review: Review) => void): Promise<Review> {
	const review = testReview();

	track(review.id);
	await db.reviews.set(review);
	await db.reviews.summaries();
	await closeStore();

	const other = new Database(join(serverDataDir(), 'recoder.db'));

	try {
		write(other, review);
	} finally {
		other.close();
	}

	return review;
}

test('a write from another connection invalidates a persisted summary', async () => {
	await writeElsewhere((other, review) =>
		other
			.query('UPDATE reviews SET value = ? WHERE id = ?')
			.run(JSON.stringify({ ...review, summary: 'CLI' }), review.id)
	);

	expect((await db.reviews.summaries())[0].summary).toBe('CLI');
});

test('the newest pull review index sees a second connection change which review outranks a draft', async () => {
	const passed = testReview({ status: 'passed', updatedAt: '2026-01-01T00:00:00Z' });
	const draft = { ...passed, id: 'draft', status: 'draft' as const, updatedAt: '2026-01-02T00:00:00Z' };
	const key = `${passed.repoId}#${passed.prNumber}`;

	track(passed.id);
	track(draft.id);
	await db.reviews.set(passed);
	await db.reviews.set(draft);

	expect((await db.reviews.latestSummaries()).get(key)?.id).toBe(passed.id);

	const other = new Database(join(serverDataDir(), 'recoder.db'));

	try {
		other
			.query('UPDATE reviews SET value = ? WHERE id = ?')
			.run(JSON.stringify({ ...draft, status: 'passed' }), draft.id);
	} finally {
		other.close();
	}

	expect((await db.reviews.latestSummaries()).get(key)?.id).toBe(draft.id);
});

test('deleted and cleared reviews leave no summaries when their ids are reused', async () => {
	const review = testReview();

	track(review.id);
	await db.reviews.set(review);
	await db.reviews.summaries();
	await db.reviews.delete(review.id);
	expect(await db.reviews.summaries()).toEqual([]);
	await db.reviews.set({ ...review, summary: 'Reused' });
	expect((await db.reviews.summaries())[0].summary).toBe('Reused');
	await db.reviews.clear();
	expect(await db.reviews.summaries()).toEqual([]);
});

test('a failed transactional update keeps the current summary', async () => {
	const review = testReview();

	track(review.id);
	await db.reviews.set(review);
	await db.reviews.summaries();
	await expect(db.reviews.update(review.id, (current) => ({ ...current!, id: 'wrong' }))).rejects.toThrow();
	expect(await db.reviews.summaries()).toEqual([reviewListItem(review)]);
});

test('a saved finding decision immediately appears in an already cached summary', async () => {
	const review = testReview({
		findings: [
			{ id: 'finding', fingerprint: 'fingerprint', file: 'a.ts', line: 1, severity: 'warning', message: 'A bug' }
		]
	});

	track(review.id);
	await db.reviews.set(review);
	expect((await db.reviews.summaries())[0].findings[0].decision).toBeUndefined();

	await db.reviews.update(review.id, (current) => ({
		...current!,
		findings: current!.findings.map((finding) => ({
			...finding,
			decision: { state: 'accepted', decidedAt: new Date().toISOString() }
		}))
	}));

	expect((await db.reviews.summaries())[0].findings[0].decision?.state).toBe('accepted');
});

test('a warm summary read does not acquire the write lock another connection owns', async () => {
	const review = testReview();

	track(review.id);
	await db.reviews.set(review);
	await db.reviews.summaries();

	const writer = new Database(join(serverDataDir(), 'recoder.db'));

	try {
		writer.run('BEGIN IMMEDIATE');
		expect(await db.reviews.summaries()).toEqual([reviewListItem(review)]);
	} finally {
		writer.run('ROLLBACK');
		writer.close();
	}
});

test('summaries an older version of the list shape stored are rebuilt when the database opens', async () => {
	const review = await writeElsewhere((other, stored) => {
		other.query('UPDATE review_list_items SET value = ? WHERE id = ?').run(JSON.stringify({ stale: true }), stored.id);
		other.query('UPDATE review_list_shape SET shape = ? WHERE id = 1').run('an older shape');
	});

	expect(await db.reviews.summaries()).toEqual([reviewListItem(review)]);
});
