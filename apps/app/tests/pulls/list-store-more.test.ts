import { describe, expect, test } from 'bun:test';
import type { PullList, PullListItem } from '@recoder/shared';

import type { PullListQuery } from '../../src/lib/api/pulls';
import { ApiError } from '../../src/lib/api/http';
import { createListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';

/** The sample's first pull request, numbered `number` in repository `repoId`. */
async function listedPull(repoId: string, number: number): Promise<PullListItem> {
	const [item] = (await createSampleApi().pulls()).items;

	return { ...item, repoId, pull: { ...item.pull, number } };
}

/** A list answer holding pull requests `numbers` of `repoId`, with a next cursor when `next` is set. */
async function answer(repoId: string, numbers: number[], next?: string): Promise<PullList> {
	const items = await Promise.all(numbers.map((number) => listedPull(repoId, number)));

	return { items, failures: [], nextCursors: next ? { [repoId]: next } : {}, fetchedAt: '2026-11-13T00:00:00Z' };
}

/** A store whose repository `big` lists pull requests 3 and 2 first, then 1; `readPage` answers the cursors. */
async function pagedStore(readPage: (query: PullListQuery) => Promise<PullList>) {
	const client = {
		...createSampleApi(),
		pulls: async (query: PullListQuery = {}) => (query.after ? readPage(query) : answer('big', [3, 2], 'page-2'))
	};

	const store = createListStore(client);

	store.reload();
	await Bun.sleep(0);
	await Bun.sleep(0);

	return store;
}

const numbers = (items: PullListItem[]) => items.map((item) => item.pull.number);

describe('reading more pull requests', () => {
	test('the next page appends after the rows shown and the cursor moves on', async () => {
		const store = await pagedStore(async () => answer('big', [1]));

		expect(store.state.getState().more.cursors).toEqual({ big: 'page-2' });

		await store.loadMore(null);

		const { more, list } = store.state.getState();

		expect(numbers(list?.items ?? [])).toEqual([3, 2]);
		expect(numbers(more.items)).toEqual([1]);
		expect(more.cursors).toEqual({});
	});

	test('a failed page keeps its cursor and says why, and a retry reads it again', async () => {
		let failing = true;

		const store = await pagedStore(async () => {
			if (failing) throw new ApiError('GitHub is slow.', 502);

			return answer('big', [1]);
		});

		await store.loadMore(null);

		expect(store.state.getState().more).toMatchObject({
			error: 'GitHub is slow.',
			loading: false,
			cursors: { big: 'page-2' }
		});

		failing = false;
		await store.loadMore(null);

		expect(store.state.getState().more).toMatchObject({ error: null, cursors: {} });
		expect(numbers(store.state.getState().more.items)).toEqual([1]);
	});

	test('a repository whose forge failed on the page counts as a failed page', async () => {
		const page: PullList = { ...(await answer('big', [])), failures: [{ repoId: 'big', error: 'GitHub timed out.' }] };
		const store = await pagedStore(async () => page);

		await store.loadMore(null);

		expect(store.state.getState().more).toMatchObject({ error: 'GitHub timed out.', cursors: { big: 'page-2' } });
	});

	test('reading again keeps the pages already read, and a refresh drops them', async () => {
		const store = await pagedStore(async () => answer('big', [1]));

		await store.loadMore(null);
		store.reload();
		await Bun.sleep(0);
		await Bun.sleep(0);

		expect(numbers(store.state.getState().more.items)).toEqual([1]);
		expect(store.state.getState().more.cursors).toEqual({});

		store.refresh();
		await Bun.sleep(0);
		await Bun.sleep(0);

		expect(store.state.getState().more.items).toEqual([]);
		expect(store.state.getState().more.cursors).toEqual({ big: 'page-2' });
	});
});
