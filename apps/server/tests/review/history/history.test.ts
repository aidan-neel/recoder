import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Review } from '@recoder/shared';
import { findingForgeStanding } from '../../../src/review/history/forge-standing';
import { withFindingHistory } from '../../../src/review/history/history';
import { closeStore, db, reviewDiffs } from '../../../src/store';
import { testReview } from '../../helpers/review';
import { FIRST_PUSH, REVERTED_PUSH, STALE_CLAIM, UNRELATED_PUSH, cacheFinding } from './fixtures';

/** Each test opens the store in its own temp data directory, so a restart reads only what it wrote. */
beforeEach(async () => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-history-'));
	await closeStore();
});

const DECIDED = { state: 'dismissed', reason: 'wrong', decidedAt: '2026-11-01T00:00:00.000Z' } as const;
const COMMENT = { id: '501', url: 'https://example.invalid/pr/1#501', inline: true };

/** A saved review of PR 7 at `headSha`, created at `createdAt`, with its diff. */
async function savedReview(headSha: string, createdAt: string, diff: string, overrides: Partial<Review> = {}) {
	const review = await db.reviews.set(testReview({ repoId: 'repo-1', prNumber: 7, headSha, createdAt, ...overrides }));

	await reviewDiffs.set(review.id, diff);

	return review;
}

/** The first push, reviewed and posted, with its finding dismissed as wrong. */
function firstReview() {
	return savedReview('sha-1', '2026-11-01T00:00:00.000Z', FIRST_PUSH, {
		findings: [cacheFinding('old-stale', STALE_CLAIM, { decision: DECIDED })],
		findingComments: { 'old-stale': COMMENT }
	});
}

test('the first review of a pull request keeps its findings without history', async () => {
	const review = await savedReview('sha-1', '2026-11-01T00:00:00.000Z', FIRST_PUSH, { status: 'running' });
	const finding = cacheFinding('a', STALE_CLAIM);

	expect(await withFindingHistory(review.id, [finding], [])).toEqual({ findings: [finding] });
});

test('history and the dismissal reason carried to a new push are still there after the server restarts', async () => {
	await firstReview();

	const next = await savedReview('sha-2', '2026-11-02T00:00:00.000Z', UNRELATED_PUSH, { status: 'running' });
	const settled = await withFindingHistory(next.id, [cacheFinding('fresh', STALE_CLAIM, { line: 22 })], []);

	await db.reviews.set({ ...next, ...settled, status: 'passed' });
	await closeStore();

	expect((await db.reviews.get(next.id))?.findings).toMatchObject([
		{ id: 'old-stale', decision: { reason: 'wrong' }, history: { firstSeenSha: 'sha-1', state: 'carried' } }
	]);
});

test('a carried finding reads as already posted, and a resolved one as posted and resolved', async () => {
	await firstReview();

	const carriedReview = await savedReview('sha-2', '2026-11-02T00:00:00.000Z', UNRELATED_PUSH, { status: 'running' });
	const carried = { ...carriedReview, ...(await withFindingHistory(carriedReview.id, [], [])) };

	expect(await findingForgeStanding(carried, 'old-stale')).toEqual({ posted: COMMENT, resolved: null });

	const revertedReview = await savedReview('sha-3', '2026-11-03T00:00:00.000Z', REVERTED_PUSH, { status: 'running' });
	const reverted = { ...revertedReview, ...(await withFindingHistory(revertedReview.id, [], [])) };

	expect(await findingForgeStanding(reverted, 'old-stale')).toMatchObject({
		posted: COMMENT,
		resolved: { resolvedAtSha: 'sha-3' }
	});
});
