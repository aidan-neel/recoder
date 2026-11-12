import { describe, expect, mock, test } from 'bun:test';
import type { DiscussRequest, DiscussResponse } from '@recoder/shared';
import { createStore } from 'zustand/vanilla';

import type { ApiClient } from '../../src/lib/api/client';
import { ApiError } from '../../src/lib/api/http';
import { createBugChat } from '../../src/lib/ask/bug-thread';
import { initialSession, type SessionData } from '../../src/lib/pull/session-state';
import { createListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';

const BUG = 'sample-f1';

type Discuss = (input: DiscussRequest, onToken: (text: string) => void) => Promise<DiscussResponse>;

function answer(reply: string): DiscussResponse {
	return { agent: 'security', model: 'm', reply };
}

/** A bug chat on the sample review whose reviewer answers through `discuss`. */
function chatWith(discuss: Discuss) {
	const calls = mock(discuss);

	const client: ApiClient = {
		...createSampleApi(),
		discuss: (_reviewId, input, onToken) => calls(input, onToken)
	};

	const state = createStore<SessionData>(() => ({ ...initialSession({}), review: SAMPLE_REVIEW }));
	const chat = createBugChat({ client, list: createListStore(client), state, repoId: 'sample-api', number: 214 });
	const lastMessage = () => state.getState().threads[BUG]?.messages.at(-1);

	return { chat, calls, lastMessage };
}

describe('asking about a finding', () => {
	test('a stream that drops before its first word is tried once more', async () => {
		let tries = 0;

		const { chat, calls, lastMessage } = chatWith(async () => {
			tries += 1;

			if (tries === 1) throw new TypeError('Failed to fetch');

			return answer('Shared bucket.');
		});

		await chat.ask(BUG, 'Why?');

		expect(calls).toHaveBeenCalledTimes(2);
		expect(lastMessage()).toMatchObject({ text: 'Shared bucket.', model: 'm', state: 'done' });
	});

	test('a reply that fails partway keeps its words and is not asked again', async () => {
		const { chat, calls, lastMessage } = chatWith(async (_input, onToken) => {
			onToken('Because the ');

			throw new TypeError('network error');
		});

		await chat.ask(BUG, 'Why?');

		expect(calls).toHaveBeenCalledTimes(1);
		expect(lastMessage()).toMatchObject({ text: 'Because the ', state: 'failed' });
	});

	test('a refusal the server would repeat is shown at once instead of asked twice', async () => {
		const { chat, calls, lastMessage } = chatWith(async () => {
			throw new ApiError('Pick a reviewer model in Settings → Agent.', 409, 'settings');
		});

		await chat.ask(BUG, 'Why?');

		expect(calls).toHaveBeenCalledTimes(1);
		expect(lastMessage()?.failure).toMatchObject({ action: 'settings' });
	});

	test('a question that got no full answer is left out of the history sent with the next one', async () => {
		const replies: Discuss[] = [
			async (_input, onToken) => {
				onToken('I looked at the ');

				throw new Error('Timed out.');
			},
			async () => answer('Yes.'),
			async () => answer('No.')
		];

		const { chat, calls } = chatWith((input, onToken) => replies[calls.mock.calls.length - 1](input, onToken));

		await chat.ask(BUG, 'First?');
		await chat.ask(BUG, 'Second?');
		await chat.ask(BUG, 'Third?');

		expect(calls.mock.calls[2][0].history).toEqual([
			{ role: 'user', body: 'Second?' },
			{ role: 'assistant', body: 'Yes.' }
		]);
	});
});
