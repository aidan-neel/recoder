import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { expect, spyOn, test } from 'bun:test';
import { emptyReviewProgress, type ReviewTask } from '@recoder/shared';
import { serverDataDir } from '../src/util/data-dir';
import { closeStore, db, evictReplays, recoverStaleReviews, reviewProgress, reviewReplays } from '../src/store';
import type { ReviewCheckpoint } from '../src/review/session/review-checkpoint';
import { testReview } from './helpers/review';

test('review progress written moments ago survives the store closing before its write-behind timer fires', async () => {
	const id = crypto.randomUUID();

	await reviewProgress.set({ ...emptyReviewProgress(id), sequence: 3, planVersion: 2 });
	await closeStore();
	expect(await reviewProgress.get(id)).toMatchObject({ sequence: 3, planVersion: 2 });
	await reviewProgress.delete(id);
	await closeStore();
	expect(await reviewProgress.get(id)).toBeUndefined();
});

test('a snapshot that fails to save does not crash the write-behind timer or hold back the others', async () => {
	const quiet = spyOn(console, 'error').mockImplementation(() => {});
	const bad = crypto.randomUUID();
	const good = crypto.randomUUID();

	/** A BigInt can't be serialized, so this snapshot's write throws every time. */
	const unsaveable = 1n as unknown as number;

	await reviewProgress.set({ ...emptyReviewProgress(bad), sequence: unsaveable });
	await reviewProgress.set({ ...emptyReviewProgress(good), sequence: 2 });
	await Bun.sleep(1000);

	const reader = new Database(join(serverDataDir(), 'recoder.db'), { readonly: true });
	const row = reader.query('SELECT value FROM review_progress WHERE id = ?').get(good) as { value: string } | null;

	reader.close();
	expect(row && JSON.parse(row.value).sequence).toBe(2);
	await reviewProgress.delete(bad);
	await reviewProgress.delete(good);
	await closeStore();
	quiet.mockRestore();
});

test('kept checkpoints are evicted oldest first past the size limit, never the one just kept', async () => {
	const kept = (id: string) => ({ id, padding: 'x'.repeat(1000) }) as unknown as ReviewCheckpoint;
	const ids = ['a', 'b', 'c'].map((name) => `${name}-${crypto.randomUUID()}`);

	await reviewReplays.clear();
	for (const id of ids) await reviewReplays.set(kept(id));
	await evictReplays(2500, ids[0]);
	expect((await reviewReplays.list()).map((item) => item.id)).toEqual([ids[0]!, ids[2]!]);
	await reviewReplays.clear();
});

test('a server restart closes out the tasks a review left running, and the closed state is what reloads', async () => {
	const review = testReview({ status: 'running' });

	const task = (id: string, status: ReviewTask['status']): ReviewTask => ({
		id,
		label: id,
		status,
		message: id,
		updatedAt: ''
	});

	await db.reviews.set(review);

	await reviewProgress.set({
		...emptyReviewProgress(review.id),
		tasks: { fetch: task('fetch', 'done'), unit: task('unit', 'running'), next: task('next', 'queued') }
	});

	await recoverStaleReviews();
	await closeStore();

	const tasks = (await reviewProgress.get(review.id))!.tasks;

	expect(Object.values(tasks).map((entry) => [entry.id, entry.status, entry.message])).toEqual([
		['fetch', 'done', 'fetch'],
		['unit', 'error', 'Stopped by a server restart'],
		['next', 'error', 'Stopped by a server restart']
	]);

	await db.reviews.delete(review.id);
	await reviewProgress.delete(review.id);
});
