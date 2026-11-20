import { expect, test } from 'bun:test';
import type { FindingSeverity, ReviewListItem } from '@recoder/shared';
import { db } from '../../src/store';
import { collection } from '../../src/storage/backend';
import { sqlite } from '../../src/storage/sqlite';
import { testReview } from '../helpers/review';
import { useTempStore } from '../helpers/temp-store';

const { track } = useTempStore('finding-tiers-');

test('legacy full records and cached summaries gain tiers on read without rewriting the stored review', async () => {
	const review = testReview({
		findings: (['error', 'warning', 'info'] as FindingSeverity[]).map((severity) => ({
			id: severity,
			file: 'a.ts',
			message: 'm',
			severity
		}))
	});

	const records = collection<typeof review>('reviews');

	track(review.id);
	await records.set(review);

	const cached: ReviewListItem = { ...review };

	sqlite().query('INSERT INTO review_list_items (id, value) VALUES (?, ?)').run(review.id, JSON.stringify(cached));
	expect((await db.reviews.get(review.id))?.findings.map((f) => f.tier)).toEqual(['bug', 'warning', 'fyi']);
	expect((await db.reviews.list()).find((r) => r.id === review.id)?.findings[2].tier).toBe('fyi');
	expect((await db.reviews.summaries())[0].findings.map((f) => f.tier)).toEqual(['bug', 'warning', 'fyi']);
	expect((await records.get(review.id))?.findings.some((f) => f.tier !== undefined)).toBe(false);
	expect(await db.reviews.get('absent')).toBeUndefined();
});
