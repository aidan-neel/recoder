import { afterEach, beforeAll, expect, test } from 'bun:test';
import { REVIEW_CANCELLED, type ReviewTask } from '@recoder/shared';
import { createReviewSession, startReviewSession } from '../../src/commands/pipeline';
import { clearReviewEvents, subscribeReview, type ReviewEvent } from '../../src/review/session/events';
import { getReviewControl } from '../../src/review/session/review-control';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { unsettledTasks } from '../../src/review/session/task-state';
import { closeStore, db, reviewProgress } from '../../src/store';
import { fetchUntilAborted } from '../helpers/fetch';
import { localForgeFixture } from '../helpers/local-forge';

/** How every brief prompt, per unit or for the whole change, begins; reviewers are prompted otherwise. */
const BRIEF_PROMPT = 'You write the brief a code change is reviewed against';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();

/** Opens the store in this file's data dir (an earlier file may have moved it), so a simulated restart reloads what this file wrote. */
beforeAll(closeStore);

afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
});

/**
 * A draft review of local PR #7 on a fake model that answers every brief call
 * with empty JSON and holds every other call until the review aborts it, so
 * the review is cancelled with its reviewers running.
 * The model has its own endpoint, so calls other test files left on a shared
 * one can't hold its concurrency slots.
 */
async function draftOnFakeModel(): Promise<{ reviewId: string; repoId: string }> {
	const { repo } = await localForgeFixture();

	db.repos.set(repo);

	setReviewOverrides({
		baseUrl: 'http://lifecycle-model.test/v1',
		apiKey: 'test',
		models: [{ id: 'lead', label: 'Lead', model: 'lead' }],
		orchestratorModelId: 'lead',
		specialistModelId: 'lead'
	});

	globalThis.fetch = (async (url, init) =>
		String(init?.body).includes(BRIEF_PROMPT)
			? Response.json({ choices: [{ message: { content: '{}' } }] })
			: fetchUntilAborted(url, init)) as typeof fetch;

	return { reviewId: createReviewSession({ repoId: repo.id, prNumber: 7 }).id, repoId: repo.id };
}

/** Resolves on the first event `matches` accepts. */
function nextEvent(reviewId: string, matches: (event: ReviewEvent) => boolean): Promise<void> {
	return new Promise((resolve) => {
		const off = subscribeReview(
			reviewId,
			(event) => {
				if (matches(event)) {
					off();
					resolve();
				}
			},
			false
		);
	});
}

const tasksOf = (reviewId: string) => Object.values(reviewProgress.get(reviewId)?.tasks ?? {});

test('a review cancelled while its reviewers run leaves every task failed as cancelled, and a restart keeps that', async () => {
	const { reviewId, repoId } = await draftOnFakeModel();
	const reviewing = nextEvent(reviewId, (event) => (event.data?.task as ReviewTask | undefined)?.kind === 'model');
	const ended = nextEvent(reviewId, (event) => event.type === 'error' && !event.step);

	try {
		startReviewSession(reviewId);
		await Promise.race([reviewing, ended]);
		expect(db.reviews.get(reviewId)).toMatchObject({ status: 'running' });
		getReviewControl(reviewId)!.cancel();
		await ended;

		const assignments = tasksOf(reviewId).filter((task) => task.id.startsWith('assignment:'));

		expect(db.reviews.get(reviewId)).toMatchObject({ status: 'failed', summary: REVIEW_CANCELLED });
		expect(assignments.length).toBeGreaterThan(0);

		expect(assignments.map((task) => [task.status, task.message])).toEqual(
			assignments.map(() => ['error', REVIEW_CANCELLED])
		);

		expect(unsettledTasks(tasksOf(reviewId))).toEqual([]);

		const before = tasksOf(reviewId);

		closeStore();
		expect(tasksOf(reviewId)).toEqual(before);
	} finally {
		db.reviews.delete(reviewId);
		clearReviewEvents(reviewId);
		db.repos.delete(repoId);
	}
}, 30_000);
