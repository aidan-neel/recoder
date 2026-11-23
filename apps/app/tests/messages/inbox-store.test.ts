import { describe, expect, test } from 'bun:test';
import type { Conversation, DirectMessage, InboxEvent } from '@recoder/shared';

import type { ApiClient } from '../../src/lib/api/client';
import { createInboxStore } from '../../src/lib/messages/inbox-store';

const WITH = {
	provider: 'github' as const,
	host: null,
	login: 'mira',
	accountId: 'a-mira',
	name: null,
	avatarUrl: null
};

function message(sequence: number): DirectMessage {
	return {
		id: `m${sequence}`,
		conversationId: 'c1',
		sequence,
		authorId: 'a-mira',
		clientId: `k${sequence}`,
		body: `hello ${sequence}`,
		attachments: [],
		createdAt: new Date(Date.UTC(2026, 10, 23, 10, sequence)).toISOString()
	};
}

function conversation(lastSequence: number): Conversation {
	return {
		id: 'c1',
		with: WITH,
		open: true,
		lastMessage: message(lastSequence),
		lastSequence,
		readSequence: 0,
		theirReadSequence: 0,
		unread: lastSequence,
		createdAt: '2026-11-23T10:00:00.000Z',
		updatedAt: message(lastSequence).createdAt
	};
}

/** An inbox over a stream the test drives, and the number of streams it opened. */
function harness() {
	let send: ((event: InboxEvent) => void) | null = null;
	let opened = 0;
	let stopped = 0;

	const client = {
		messages: {
			follow(handlers: { onMessage: (event: InboxEvent) => void }) {
				opened += 1;
				send = handlers.onMessage;

				return () => {
					stopped += 1;
				};
			},
			list: async () => []
		}
	} as unknown as ApiClient;

	return {
		inbox: createInboxStore(client),
		send: (event: InboxEvent) => send?.(event),
		streams: () => ({ opened, stopped })
	};
}

describe('createInboxStore', () => {
	test('keeps a message that a reconnect replays once, in order', () => {
		const { inbox, send } = harness();

		inbox.follow();
		send({ type: 'snapshot', cursor: 0, conversations: [] });
		send({ type: 'message', cursor: 2, conversation: conversation(2), message: message(2) });
		send({ type: 'message', cursor: 1, conversation: conversation(1), message: message(1) });
		send({ type: 'message', cursor: 2, conversation: conversation(2), message: message(2) });

		expect(inbox.state.getState().arrivals.c1.map((item) => item.sequence)).toEqual([1, 2]);
		expect(inbox.state.getState().conversations).toHaveLength(1);
	});

	test('shares one stream between followers and closes it after the last one leaves', () => {
		const { inbox, streams } = harness();
		const stopFirst = inbox.follow();
		const stopSecond = inbox.follow();

		stopFirst();
		expect(streams()).toEqual({ opened: 1, stopped: 0 });

		stopSecond();
		expect(streams()).toEqual({ opened: 1, stopped: 1 });
	});
});
