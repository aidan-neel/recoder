import type { Conversation, DirectMessage, InboxEvent } from '@recoder/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../api/client';
import type { Connection } from '../api/event-stream';

interface InboxState {
	/** `loading` until the stream's first snapshot. */
	phase: 'loading' | 'ready';
	connection: Connection;
	/** Newest message first. */
	conversations: Conversation[];
	/** Messages that arrived live, by conversation, oldest first: a conversation page merges them with what it read. */
	arrivals: Record<string, DirectMessage[]>;
}

/**
 * The signed-in person's conversations and unread counts, kept live from the inbox stream while anything follows it.
 * The sidebar, the window tabs and a conversation page all read the same copy.
 */
export interface InboxStore {
	state: StoreApi<InboxState>;
	/** Follows the inbox until the returned stop is called; several followers share one stream. */
	follow: () => () => void;
	/** A conversation the app learned of outside the stream, such as one it just started. */
	keep: (conversation: Conversation) => void;
}

function byNewest(a: Conversation, b: Conversation): number {
	return b.updatedAt.localeCompare(a.updatedAt);
}

function withConversation(list: Conversation[], conversation: Conversation): Conversation[] {
	return [conversation, ...list.filter((item) => item.id !== conversation.id)].sort(byNewest);
}

function withArrival(
	arrivals: Record<string, DirectMessage[]>,
	message: DirectMessage
): Record<string, DirectMessage[]> {
	const held = arrivals[message.conversationId] ?? [];

	if (held.some((item) => item.sequence === message.sequence)) return arrivals;

	return { ...arrivals, [message.conversationId]: [...held, message].sort((a, b) => a.sequence - b.sequence) };
}

export function createInboxStore(client: ApiClient): InboxStore {
	const state = createStore<InboxState>(() => ({
		phase: 'loading',
		connection: 'closed',
		conversations: [],
		arrivals: {}
	}));

	let followers = 0;
	let stop: (() => void) | null = null;

	function received(event: InboxEvent): void {
		switch (event.type) {
			case 'snapshot':
				state.setState({ phase: 'ready', conversations: [...event.conversations].sort(byNewest) });

				return;
			case 'message':
				state.setState((current) => ({
					conversations: withConversation(current.conversations, event.conversation),
					arrivals: withArrival(current.arrivals, event.message)
				}));

				return;
			case 'read':
				state.setState((current) => ({ conversations: withConversation(current.conversations, event.conversation) }));

				return;
			case 'heartbeat':
				return;
		}
	}

	/** A stream that went quiet re-reads the list, so counts never stay stale while it reconnects. */
	function reread(): void {
		void client.messages.list().then(
			(conversations) => state.setState({ phase: 'ready', conversations: [...conversations].sort(byNewest) }),
			() => undefined
		);
	}

	return {
		state,

		follow() {
			followers += 1;

			if (!stop)
				stop = client.messages.follow({
					onMessage: received,
					onConnection: (connection) => state.setState({ connection }),
					onStale: reread
				});

			return () => {
				followers -= 1;

				if (followers > 0 || !stop) return;

				stop();
				stop = null;
			};
		},

		keep(conversation) {
			state.setState((current) => ({ conversations: withConversation(current.conversations, conversation) }));
		}
	};
}
