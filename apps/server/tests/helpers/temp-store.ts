import { afterAll, afterEach, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeStore, db, reviewMetrics } from '../../src/store';

/**
 * Opens the store in a new temporary data dir for the whole file and puts the
 * old dir back after it; the reviews passed to `track` are deleted with their
 * metrics after each test.
 */
export function useTempStore(prefix: string): { track: (reviewId: string) => void } {
	const originalDataDir = process.env.RECODER_DATA_DIR;
	const ids: string[] = [];

	beforeAll(async () => {
		process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), prefix));
		await closeStore();
	});

	afterAll(async () => {
		await closeStore();
		if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
		else process.env.RECODER_DATA_DIR = originalDataDir;
	});

	afterEach(async () => {
		for (const id of ids.splice(0)) {
			await db.reviews.delete(id);
			await reviewMetrics.delete(id);
		}
	});

	return { track: (reviewId) => ids.push(reviewId) };
}
