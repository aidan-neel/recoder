import { afterEach, beforeAll, expect, test } from 'bun:test';
import { createReviewSession, startReviewSession } from '../../src/commands/pipeline';
import { clearReviewEvents, subscribeReview } from '../../src/review/session/events';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { closeStore, db } from '../../src/store';
import { localForgeFixture } from '../helpers/local-forge';

/** How every brief prompt, per unit or for the whole change, begins; reviewers are prompted otherwise. */
const BRIEF_PROMPT = 'You write the brief a code change is reviewed against';

/** What the fake provider answers every reviewer call with: an error that is neither transient nor a blocked model. */
const REJECTION = 'the provider could not serve this model';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();

beforeAll(closeStore);

afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
});

/** Resolves once the review's run has ended, passed or failed. */
function runEnded(reviewId: string): Promise<void> {
	return new Promise((resolve) => {
		const off = subscribeReview(
			reviewId,
			(event) => {
				if ((event.type === 'done' || event.type === 'error') && !event.step) {
					off();
					resolve();
				}
			},
			false
		);
	});
}

test('a review whose every reviewer call is rejected fails with the reason instead of passing', async () => {
	const { repo } = await localForgeFixture();

	await db.repos.set(repo);

	setReviewOverrides({
		baseUrl: 'http://rejecting-model.test/v1',
		apiKey: 'test',
		models: [{ id: 'lead', label: 'Lead', model: 'lead' }],
		orchestratorModelId: 'lead',
		specialistModelId: 'lead'
	});

	globalThis.fetch = (async (_url, init) =>
		String(init?.body).includes(BRIEF_PROMPT)
			? Response.json({ choices: [{ message: { content: '{}' } }] })
			: Response.json({ error: { message: REJECTION } }, { status: 400 })) as typeof fetch;

	const reviewId = (await createReviewSession({ repoId: repo.id, prNumber: 7 })).id;
	const ended = runEnded(reviewId);

	try {
		await startReviewSession(reviewId);
		await ended;

		const review = await db.reviews.get(reviewId);

		expect(review?.status).toBe('failed');
		expect(review?.summary).toStartWith('No reviewer could run: ');
	} finally {
		await db.reviews.delete(reviewId);
		clearReviewEvents(reviewId);
		await db.repos.delete(repo.id);
	}
}, 30_000);
