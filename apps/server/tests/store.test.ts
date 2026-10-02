import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { expect, spyOn, test } from 'bun:test';
import { emptyReviewProgress } from '@recoder/shared';
import { serverDataDir } from '../src/util/data-dir';
import { closeStore, reviewProgress } from '../src/store';

test('review progress written moments ago survives the store closing before its write-behind timer fires', () => {
	const id = crypto.randomUUID();

	reviewProgress.set({ ...emptyReviewProgress(id), sequence: 3, planSummary: 'two specialists' });
	// Nothing has reached SQLite yet; closing must flush, and a fresh handle must read it back.
	closeStore();
	expect(reviewProgress.get(id)).toMatchObject({ sequence: 3, planSummary: 'two specialists' });
	reviewProgress.delete(id);
	closeStore();
	expect(reviewProgress.get(id)).toBeUndefined();
});

test('a snapshot that fails to save does not crash the write-behind timer or hold back the others', async () => {
	const quiet = spyOn(console, 'error').mockImplementation(() => {});
	const bad = crypto.randomUUID();
	const good = crypto.randomUUID();

	// A BigInt can't be serialized, so this snapshot's write throws every time.
	reviewProgress.set({ ...emptyReviewProgress(bad), sequence: 1n as unknown as number });
	reviewProgress.set({ ...emptyReviewProgress(good), sequence: 2 });
	await Bun.sleep(1000);

	const reader = new Database(join(serverDataDir(), 'recoder.db'), { readonly: true });
	const row = reader.query('SELECT value FROM review_progress WHERE id = ?').get(good) as { value: string } | null;

	reader.close();
	expect(row && JSON.parse(row.value).sequence).toBe(2);
	reviewProgress.delete(bad);
	reviewProgress.delete(good);
	closeStore();
	quiet.mockRestore();
});
