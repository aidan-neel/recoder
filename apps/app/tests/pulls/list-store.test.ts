import { describe, expect, test } from 'bun:test';
import type { PullList, Review } from '@recoder/shared';

import type { ApiClient } from '../../src/lib/api/client';
import { ApiError } from '../../src/lib/api/http';
import { createListStore, type ListData, type ListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';

const TARGET = { repoId: 'sample-api', number: 205, title: 'Ready change', headSha: 'abc' };

const KEY = 'sample-api#205';

/** A client whose review start waits until the test settles it. */
function heldStart() {
	const held = Promise.withResolvers<Review>();
	const client: ApiClient = { ...createSampleApi(), createReview: () => held.promise };

	return { client, held };
}

describe('starting a review from the list', () => {
	test('the row shows the review as queued at once, before the server answers', () => {
		const { client } = heldStart();
		const store = createListStore(client);

		void store.start(TARGET);

		const { started, starting } = store.state.getState();

		expect(started[KEY]).toMatchObject({ status: 'queued', repoId: 'sample-api', prNumber: 205, headSha: 'abc' });
		expect(starting.has(KEY)).toBe(true);
	});

	test('a failed start takes the queued review back and rejects with a plain sentence', async () => {
		const { client, held } = heldStart();
		const store = createListStore(client);
		const started = store.start(TARGET);

		held.reject(new ApiError('A review of this head is already running.', 409));

		await expect(started).rejects.toThrow('A review of this head is already running.');

		expect(store.state.getState().started).toEqual({});
		expect(store.state.getState().starting.size).toBe(0);
	});

	test('a second start of the same pull request while one is in flight is refused', async () => {
		const { client } = heldStart();
		const store = createListStore(client);

		void store.start(TARGET);

		await expect(store.start(TARGET)).rejects.toThrow('This review is already starting.');
	});

	test('a started review replaces its placeholder with the server’s record', async () => {
		const { client, held } = heldStart();
		const store = createListStore(client);
		const started = store.start(TARGET);
		const review = await createSampleApi().createReview({ repoId: 'sample-api', prNumber: 205, start: false });

		held.resolve(review);
		await started;

		expect(store.state.getState().started[KEY]?.id).toBe(review.id);
		expect(store.state.getState().starting.size).toBe(0);
	});
});

/** Resolves once the store's state passes `check`. */
function reaches(store: ListStore, check: (data: ListData) => boolean): Promise<void> {
	return new Promise((resolve) => {
		if (check(store.state.getState())) resolve();

		store.state.subscribe((data) => {
			if (check(data)) resolve();
		});
	});
}

describe('loading the list', () => {
	test('the repositories, reviews and chats land while the pull requests still wait on the forges', async () => {
		const sample = createSampleApi();
		const pulls = Promise.withResolvers<PullList>();
		const store = createListStore({ ...sample, pulls: () => pulls.promise });

		store.reload();
		await reaches(store, (data) => data.repos !== null);

		expect(store.state.getState()).toMatchObject({ phase: 'loading', list: null });
		expect(store.state.getState().chats).not.toBeNull();

		pulls.resolve(await sample.pulls());
		await reaches(store, (data) => data.phase === 'ready');

		expect(store.state.getState().list).not.toBeNull();
	});
});
