import { describe, expect, test } from 'bun:test';
import type { RepoChat } from '@recoder/shared';

import type { ApiClient } from '../../src/lib/api/client';
import { ApiError } from '../../src/lib/api/http';
import { createChatCache } from '../../src/lib/chat/chat-cache';
import { createSampleApi } from '../../src/lib/sample/sample-api';

/** A chat's record, enough to hold and hand back. */
function chat(id: string): RepoChat {
	return { id, repoId: 'repo', title: `Chat ${id}`, createdAt: '', updatedAt: '', messages: [] };
}

/** A client that counts chat reads; `fail` makes every read reject. */
function countingClient(fail = false) {
	let calls = 0;

	const client: ApiClient = {
		...createSampleApi(),
		repoChat: async (id) => {
			calls++;
			if (fail) throw new ApiError('Not found', 404);

			return chat(id);
		}
	};

	return {
		client,
		calls: () => calls
	};
}

describe('chats kept between visits', () => {
	test('concurrent reads of one chat share one request and the answer is held', async () => {
		const { client, calls } = countingClient();
		const chats = createChatCache(client);

		expect(chats.peek('c1')).toBeNull();

		const [a, b] = await Promise.all([chats.read('c1'), chats.read('c1')]);

		expect(a).toBe(b);
		expect(calls()).toBe(1);
		expect(chats.peek('c1')).toBe(a);
	});

	test('a settled read reads again, so a page opening later sees a fresh copy', async () => {
		const { client, calls } = countingClient();
		const chats = createChatCache(client);

		await chats.read('c1');
		await chats.read('c1');

		expect(calls()).toBe(2);
	});

	test('a copy the stream delivered is what a visit shows first', async () => {
		const { client } = countingClient();
		const chats = createChatCache(client);
		const streamed = { ...chat('c1'), title: 'Renamed' };

		chats.keep('c1', streamed);

		expect(chats.peek('c1')).toBe(streamed);
	});

	test('a failed read keeps nothing and the next read tries again', async () => {
		const { client, calls } = countingClient(true);
		const chats = createChatCache(client);

		await expect(chats.read('c1')).rejects.toThrow('Not found');
		expect(chats.peek('c1')).toBeNull();
		expect(calls()).toBe(1);
	});

	test('warming starts the read a visit then joins', async () => {
		const { client, calls } = countingClient();
		const chats = createChatCache(client);

		chats.warm('c1');
		chats.warm('c1');
		await chats.read('c1');

		expect(calls()).toBe(1);
	});

	test('forgetting drops the held copy', async () => {
		const { client } = countingClient();
		const chats = createChatCache(client);

		await chats.read('c1');
		chats.forget('c1');

		expect(chats.peek('c1')).toBeNull();
	});
});
