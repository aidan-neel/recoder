import { describe, expect, test } from 'bun:test';

import { ApiError } from '../../src/lib/api/http';
import { createListStore, type ListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';

/** A store that has read the sample's reviews and chats; `deleteFails` makes the review delete fail with it. */
async function loadedStore(deleteFails?: ApiError) {
	const client = createSampleApi();
	const store = createListStore(deleteFails ? { ...client, deleteReview: () => Promise.reject(deleteFails) } : client);

	store.state.setState({ reviews: await client.reviews(), chats: await client.repoChats(5) });

	return store;
}

/** Starts deleting the first review and hands back its id and the pending delete. */
async function deleteFirstReview(store: ListStore): Promise<{ id: string; deleted: Promise<void> }> {
	const id = store.state.getState().reviews?.[0].id ?? '';

	return { id, deleted: store.deleteReview(id) };
}

function listsReview(store: ListStore, id: string): boolean {
	return store.state.getState().reviews?.some((review) => review.id === id) ?? false;
}

describe('deleting from the sidebar lists', () => {
	test('a deleted review leaves the list at once', async () => {
		const store = await loadedStore();
		const { id, deleted } = await deleteFirstReview(store);

		await deleted;

		expect(listsReview(store, id)).toBe(false);
	});

	test('a deleted chat leaves the list', async () => {
		const store = await loadedStore();
		const id = store.state.getState().chats?.[0].id ?? '';

		await store.deleteChat(id);

		expect(store.state.getState().chats).toEqual([]);
	});

	test('a review the server no longer has is still dropped from the list', async () => {
		const store = await loadedStore(new ApiError('review not found', 404));
		const { id, deleted } = await deleteFirstReview(store);

		await deleted;

		expect(listsReview(store, id)).toBe(false);
	});

	test('a failed delete keeps the row and rejects', async () => {
		const store = await loadedStore(new ApiError('database is locked', 500));
		const { id, deleted } = await deleteFirstReview(store);

		await expect(deleted).rejects.toThrow('database is locked');

		expect(listsReview(store, id)).toBe(true);
	});
});
