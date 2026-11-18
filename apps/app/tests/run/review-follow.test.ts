import { describe, expect, test } from 'bun:test';
import { reviewListItem, type CreateReviewInput, type ProgressMessage, type Review } from '@recoder/shared';
import { createStore } from 'zustand/vanilla';

import type { ApiClient } from '../../src/lib/api/client';
import { initialSession, type SessionData } from '../../src/lib/pull/session-state';
import { createListStore } from '../../src/lib/pulls/list-store';
import type { StreamHandlers } from '../../src/lib/api/event-stream';
import { createReviewFollow } from '../../src/lib/run/review-follow';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { createSampleApi } from '../../src/lib/sample/sample-api';

/** The sample review as created at `createdAt`, with id `id`. */
function reviewAt(id: string, createdAt: string): Review {
	return { ...structuredClone(SAMPLE_REVIEW), id, createdAt, updatedAt: createdAt };
}

const OLDER = reviewAt('review-a', '2026-10-13T09:00:00.000Z');

const NEWER = reviewAt('review-b', '2026-10-13T10:00:00.000Z');

/** A review follow over `overrides` of the sample client; it records each stream it opens. */
function followWith(overrides: Partial<ApiClient>) {
	const streams: { id: string; handlers: StreamHandlers<ProgressMessage> }[] = [];

	const client: ApiClient = {
		...createSampleApi(),
		follow: (id, handlers) => {
			streams.push({ id, handlers });

			return () => {};
		},
		...overrides
	};

	const state = createStore<SessionData>(() => initialSession({}));
	const events = { reviewFollowed: () => {}, reviewSettled: () => {} };

	const review = createReviewFollow(
		{ client, list: createListStore(client), state, repoId: 'sample-api', number: 214 },
		events
	);

	return { review, state, streams };
}

describe('the review before the one that runs', () => {
	test('a finished review a new run replaces stays as the previous review until the run ends', async () => {
		const finished: Review = { ...OLDER, status: 'passed' };
		const running: Review = { ...NEWER, status: 'running', findings: [] };
		const { review, state, streams } = followWith({ createReview: async () => running, review: async () => finished });

		review.open();
		review.sync(reviewListItem(finished));
		await Promise.resolve();
		await review.start();

		expect(state.getState().review?.id).toBe(running.id);
		expect(state.getState().previousReview?.id).toBe(finished.id);

		streams
			.at(-1)
			?.handlers.onMessage({ type: 'heartbeat', review: { ...running, status: 'passed' } } as ProgressMessage);

		expect(state.getState().previousReview).toBeNull();
	});
});

describe('following the newest review', () => {
	test('a page that answers after the session closed starts no stream', () => {
		const { review, streams } = followWith({ review: async () => OLDER });

		review.open();
		review.close();
		review.sync(reviewListItem(OLDER));

		expect(streams).toEqual([]);
	});

	test('a page read that answers with an older review after another started keeps following the new one', async () => {
		const { review, state, streams } = followWith({ createReview: async () => NEWER, review: async () => OLDER });

		review.open();
		await review.start();
		review.sync(reviewListItem(OLDER));

		expect(state.getState().review?.id).toBe(NEWER.id);
		expect(streams.map((stream) => stream.id)).toEqual([NEWER.id]);
	});

	test('a review read that answers after a newer live snapshot leaves the snapshot’s decisions', async () => {
		const read = Promise.withResolvers<Review>();
		const { review, state, streams } = followWith({ review: () => read.promise });
		const [finding] = OLDER.findings;

		const decided: Review = {
			...OLDER,
			findings: [{ ...finding, decision: { state: 'accepted', decidedAt: '2026-10-13T09:30:00.000Z' } }]
		};

		review.open();
		review.sync(reviewListItem(OLDER));
		streams[0].handlers.onMessage({ type: 'snapshot', review: decided });
		read.resolve(OLDER);
		await read.promise;
		await Promise.resolve();

		expect(state.getState().review?.findings[0].decision).toMatchObject({ state: 'accepted' });
	});

	test('a Spark start on a draft session queues a new Spark review instead of running the draft', async () => {
		const asked: CreateReviewInput[] = [];
		const draft: Review = { ...OLDER, status: 'draft' };

		const { review, state } = followWith({
			createReview: async (input) => {
				asked.push(input);

				return { ...NEWER, speed: 'spark' };
			},
			startDraft: async () => {
				throw new Error('The draft must not run as a Spark review.');
			}
		});

		review.open();
		state.setState({ review: draft });
		await review.start('spark');

		expect(asked.map((input) => input.speed)).toEqual(['spark']);
		expect(state.getState().review?.id).toBe(NEWER.id);
	});
});
