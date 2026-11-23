import type {
	Conversation,
	ConversationList,
	ConversationPage,
	DirectMessage,
	InboxEvent,
	SendMessageInput
} from '@recoder/shared';

import type { StreamHandlers } from './event-stream';
import { post, request, seg } from './http';

/** Direct messages between people on this server. */
export interface MessagesApi {
	/** Every conversation of the signed-in person, newest message first. */
	list: () => Promise<Conversation[]>;
	/** The conversation with this account, made on first use; rejects with a 409 for someone who can't be messaged. */
	start: (accountId: string) => Promise<Conversation>;
	/** A page of a conversation, oldest first; `before` reads the page older than that sequence. */
	page: (conversationId: string, before?: number) => Promise<ConversationPage>;
	/** Sends a message; a repeat of the same `clientId` answers the message already sent. */
	send: (conversationId: string, input: SendMessageInput) => Promise<DirectMessage>;
	/** Moves the signed-in person's read mark forward to `through`. */
	read: (conversationId: string, through: number) => Promise<Conversation>;
	/** Follows the signed-in person's inbox until the returned stop is called. */
	follow: (handlers: StreamHandlers<InboxEvent>) => () => void;
}

function conversationPath(id: string): string {
	return `/api/messages/${seg(id)}`;
}

/** The review server's messages, given how the client opens an event stream. */
export function messagesApi(
	followStream: (path: string, handlers: StreamHandlers<InboxEvent>) => () => void
): MessagesApi {
	return {
		list: async () => (await request<ConversationList>('/api/messages')).conversations,
		start: (accountId) => post<Conversation>('/api/messages', { accountId }),
		page: (id, before) =>
			request<ConversationPage>(
				before === undefined ? conversationPath(id) : `${conversationPath(id)}?before=${before}`
			),
		send: (id, input) => post<DirectMessage>(conversationPath(id), input),
		read: (id, through) => post<Conversation>(`${conversationPath(id)}/read`, { through }),
		follow: (handlers) => followStream('/api/messages/events', handlers)
	};
}
