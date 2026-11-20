import { expect, test } from 'bun:test';
import { emptyReviewProgress, type DiffGuide } from '@recoder/shared';
import { harnessCallbacks } from '../../src/commands/pipeline-callbacks';
import { flushReviewEvents } from '../../src/review/session/events';
import { closeStore, db, reviewProgress } from '../../src/store';
import { localApp } from '../helpers/local-app';
import { testReview } from '../helpers/review';
import { useTempStore } from '../helpers/temp-store';

useTempStore('recoder-diff-guide-');

test('queued guide updates survive reopening and reach both the review API and its progress snapshot', async () => {
	const review = await db.reviews.set(testReview({ status: 'running' }));
	const seed: DiffGuide = { source: 'deterministic', groups: [] };

	const guide: DiffGuide = {
		source: 'model',
		groups: [
			{
				id: 'g1',
				title: 'Core',
				explanation: 'Read the definition.',
				hunks: [{ id: 'h1', file: 'core.ts', explanation: 'Changes the return value.' }]
			}
		]
	};

	await reviewProgress.set(emptyReviewProgress(review.id));

	const callbacks = harnessCallbacks(review.id, { headSha: 'head', mergeBaseSha: 'base' });

	callbacks?.onDiffGuide?.(seed);
	callbacks?.onDiffGuide?.(guide);
	await flushReviewEvents(review.id);
	await closeStore();
	expect((await reviewProgress.get(review.id))?.diffGuide).toEqual(guide);
	expect((await db.reviews.get(review.id))?.diffGuide).toEqual(guide);

	const response = await localApp.request(`/api/reviews/${review.id}`);

	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ diffGuide: guide });
});
