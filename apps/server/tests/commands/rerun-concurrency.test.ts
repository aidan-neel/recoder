import { afterEach, expect, test } from 'bun:test';
import { startReviewSession } from '../../src/commands/pipeline';
import { continueReviewSession, replayReviewSession, rerunReviewSession } from '../../src/commands/rerun';
import { clearReviewEvents } from '../../src/review/session/events';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { CHECKPOINT_VERSION, type ReviewCheckpoint } from '../../src/review/session/review-checkpoint';
import { db, reviewReplays } from '../../src/store';
import { reviewEnded } from '../helpers/fake-reviewer';
import { testReview } from '../helpers/review';

const original = getStoredSettings();
const ids: string[] = [];

afterEach(async () => {
	setReviewOverrides(original);

	for (const id of ids.splice(0)) {
		await db.reviews.delete(id);
		await reviewReplays.delete(id);
		await clearReviewEvents(id);
	}
});

for (const action of ['continue', 'rerun', 'replay'] as const) {
	test(`concurrent ${action} requests claim a finished review only once`, async () => {
		setReviewOverrides({
			baseUrl: 'https://model.test/v1',
			apiKey: 'test',
			models: [{ id: 'test', label: 'Test', model: 'test' }],
			orchestratorModelId: 'test',
			specialistModelId: 'test'
		});

		const review = testReview({ repoId: 'missing-repo', status: action === 'continue' ? 'failed' : 'passed' });

		const checkpoint: ReviewCheckpoint = {
			id: review.id,
			version: CHECKPOINT_VERSION,
			headSha: 'test',
			mergeBaseSha: 'base',
			directive: null,
			units: [],
			assignments: [],
			candidates: [],
			coverage: [],
			evidence: { records: [], seq: 0, toolSeq: 0 },
			recommended: [],
			retriesDone: false,
			subagents: { requests: [], units: null, dropped: [] }
		};

		ids.push(review.id);
		await db.reviews.set(review);
		await reviewReplays.set(checkpoint);

		const ended = reviewEnded(review.id);

		const start =
			action === 'continue'
				? continueReviewSession
				: action === 'rerun'
					? rerunReviewSession
					: (id: string) => replayReviewSession(id, false);

		const outcomes = await Promise.allSettled([start(review.id), start(review.id)]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
		await ended;
	});
}

test('missing reviews keep their not-found error for every start action', async () => {
	const id = crypto.randomUUID();

	for (const start of [
		startReviewSession,
		continueReviewSession,
		rerunReviewSession,
		(reviewId: string) => replayReviewSession(reviewId, false)
	]) {
		await expect(start(id)).rejects.toThrow('review not found');
	}
});
