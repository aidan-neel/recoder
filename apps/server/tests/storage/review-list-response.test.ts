import { expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { closeStore, db } from '../../src/store';
import { pullStates } from '../../src/forge/pulls/pull-states';
import { reviewListJson } from '../../src/storage/review-list-response';
import { serverDataDir } from '../../src/util/data-dir';
import { testReview } from '../helpers/review';
import { useTempStore } from '../helpers/temp-store';

const { track } = useTempStore('recoder-list-response-');

test('full-list serialization is reused until a review or pull state changes', async () => {
	const review = testReview();
	const load = mock(async () => JSON.stringify(await db.reviews.list()));

	track(review.id);
	await db.reviews.set(review);
	await reviewListJson(load);
	await reviewListJson(load);
	expect(load).toHaveBeenCalledTimes(1);
	await db.reviews.update(review.id, (current) => ({ ...current!, summary: 'Updated' }));
	expect(JSON.parse(await reviewListJson(load))[0].summary).toBe('Updated');

	await pullStates.set({
		id: `${review.repoId}#1`,
		repoId: review.repoId,
		number: 1,
		state: 'merged',
		checkedAt: new Date().toISOString()
	});

	await reviewListJson(load);
	expect(load).toHaveBeenCalledTimes(3);
	await pullStates.clear();
	await db.reviews.delete(review.id);
	expect(await reviewListJson(load)).toBe('[]');
});

test('a write on another connection invalidates a full-list response', async () => {
	const review = testReview();
	const load = async () => JSON.stringify(await db.reviews.list());

	track(review.id);
	await db.reviews.set(review);
	await reviewListJson(load);

	const other = new Database(join(serverDataDir(), 'recoder.db'));

	try {
		other
			.query('UPDATE reviews SET value = ? WHERE id = ?')
			.run(JSON.stringify({ ...review, summary: 'External' }), review.id);
	} finally {
		other.close();
	}

	expect(JSON.parse(await reviewListJson(load))[0].summary).toBe('External');
});

test('concurrent serialization joins a load and an intervening write prevents it being cached', async () => {
	const review = testReview();
	const waiting = Promise.withResolvers<string>();
	const load = mock(() => waiting.promise);

	track(review.id);
	await db.reviews.set(review);

	const first = reviewListJson(load);
	const second = reviewListJson(load);

	expect(load).toHaveBeenCalledTimes(1);
	await db.reviews.update(review.id, (current) => ({ ...current!, summary: 'New' }));
	waiting.resolve('old');
	await Promise.all([first, second]);
	expect(await reviewListJson(async () => 'new')).toBe('new');
});

test('switching to another data directory never reuses the previous stores response', async () => {
	const review = testReview();
	const load = async () => JSON.stringify(await db.reviews.list());
	const original = process.env.RECODER_DATA_DIR;
	const directory = await mkdtemp(join(tmpdir(), 'recoder-response-other-'));

	track(review.id);
	await db.reviews.set(review);
	await reviewListJson(load);
	await closeStore();
	process.env.RECODER_DATA_DIR = directory;

	try {
		expect(await reviewListJson(load)).toBe('[]');
	} finally {
		await closeStore();
		process.env.RECODER_DATA_DIR = original;
	}
});
