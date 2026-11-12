import { expect, test } from 'bun:test';
import { touch } from '../../src/commands/pipeline';
import { savePullComment } from '../../src/forge/publish/record';
import { db } from '../../src/store';
import { testReview } from '../helpers/review';

test('concurrent review and pull-comment updates preserve both changes', async () => {
	const review = testReview();

	await db.reviews.set(review);
	await Promise.all([touch(review.id, { summary: 'Complete' }), savePullComment(review.id, { state: 'posted' })]);
	expect(await db.reviews.get(review.id)).toMatchObject({ summary: 'Complete', pullComment: { state: 'posted' } });
	await db.reviews.delete(review.id);
});
