import { describe, expect, mock, test } from 'bun:test';
import { ORCHESTRATOR_ID, type ReviewChatMessage } from '@recoder/shared';
import { createStore } from 'zustand/vanilla';

import type { ApiClient } from '../../src/lib/api/client';
import { ApiError } from '../../src/lib/api/http';
import { createPullChat } from '../../src/lib/ask/pull-chat';
import { initialSession, type SessionData } from '../../src/lib/pull/session-state';
import { createListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';

const NEXT_REVIEW = { ...SAMPLE_REVIEW, id: 'review-next' };

/** A pull chat on the sample review whose first send fails; it records where each send went. */
function chatWhoseFirstSendFails() {
	const sends = mock(async (reviewId: string, text: string): Promise<ReviewChatMessage> => {
		if (sends.mock.calls.length === 1) throw new ApiError('The review is busy.', 409);

		return {
			id: `sent-${reviewId}`,
			assignmentId: ORCHESTRATOR_ID,
			from: 'user',
			text,
			at: '2026-10-13T10:00:00.000Z',
			status: 'done'
		};
	});

	const client: ApiClient = { ...createSampleApi(), sendChat: sends };
	const state = createStore<SessionData>(() => ({ ...initialSession({}), review: SAMPLE_REVIEW }));
	const drafts = { openDraft: async () => SAMPLE_REVIEW.id };

	const chat = createPullChat(
		{ client, list: createListStore(client), state, repoId: 'sample-api', number: 214 },
		drafts
	);

	return { chat, state, sends };
}

describe('the pull request conversation when another review is followed', () => {
	test('what was sent to the earlier review leaves the conversation', async () => {
		const { chat, state } = chatWhoseFirstSendFails();

		await chat.send('Why?');
		state.setState({ review: NEXT_REVIEW });
		chat.reviewFollowed(NEXT_REVIEW.id);

		expect(state.getState().outbox).toEqual([]);
	});

	test('a retry goes to the review the message was first sent to', async () => {
		const { chat, state, sends } = chatWhoseFirstSendFails();

		await chat.send('Why?');
		state.setState({ review: NEXT_REVIEW });
		await chat.resend(state.getState().outbox[0].key);

		expect(sends.mock.calls.map(([reviewId]) => reviewId)).toEqual([SAMPLE_REVIEW.id, SAMPLE_REVIEW.id]);
	});
});
