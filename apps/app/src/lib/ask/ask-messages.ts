import type { ReviewChatMessage } from '@recoder/shared';

import type { AskMessage, AskThread } from './bug-thread';
import { chatText } from './chat-text';
import { conversationRows, orchestratorMessages, type ConversationRow, type Outgoing } from './conversation';
import type { AskMessageView } from './types';

/** What a reply that failed without a reason says. */
const NO_REASON = 'The reply stopped before it finished.';

/** A reply the reader stopped keeps its words and reads as done. */
const THREAD_STATE: Record<AskMessage['state'], AskMessageView['state']> = {
	streaming: 'writing',
	done: 'done',
	stopped: 'done',
	failed: 'failed'
};

/** The rows of the pull request's conversation: the server's messages, then what this page sent that they do not carry yet. */
export function pullRows(messages: ReviewChatMessage[] | undefined, outbox: Outgoing[]): ConversationRow[] {
	return conversationRows(orchestratorMessages(messages), outbox);
}

/** A person's question or Recoder's own reply; reviewer threads it was copied on and system notes are left out. */
function isShown(row: ConversationRow): boolean {
	return row.kind === 'outgoing' || (row.message.from !== 'system' && !row.message.forwardedFrom);
}

function serverState(message: ReviewChatMessage): AskMessageView['state'] {
	if (message.status === 'error' || message.failure) return 'failed';
	if (message.status === 'streaming') return 'writing';

	return 'done';
}

function serverMessage(key: string, message: ReviewChatMessage): AskMessageView {
	const state = serverState(message);

	return {
		id: key,
		from: message.from === 'user' ? 'person' : 'recoder',
		text: message.from === 'user' ? message.text : chatText(message.text, state !== 'writing'),
		state,
		error: state === 'failed' ? (message.failure?.reason ?? NO_REASON) : null,
		at: message.at
	};
}

function outgoingMessage(outgoing: Outgoing): AskMessageView {
	return {
		id: outgoing.key,
		from: 'person',
		text: outgoing.text,
		state: outgoing.state === 'failed' ? 'failed' : 'done',
		error: outgoing.failure?.message ?? null,
		at: null
	};
}

/** The pull request's conversation as the Summary tab shows it. */
export function pullMessages(rows: ConversationRow[]): AskMessageView[] {
	return rows
		.filter(isShown)
		.map((row) => (row.kind === 'message' ? serverMessage(row.key, row.message) : outgoingMessage(row.outgoing)));
}

/** A thread about one finding as the Bugs tab shows it. */
export function bugMessages(thread: AskThread): AskMessageView[] {
	return thread.messages.map((message) => ({
		id: message.id,
		from: message.role === 'user' ? 'person' : 'recoder',
		text: message.role === 'user' ? message.text : chatText(message.text, message.state !== 'streaming'),
		state: THREAD_STATE[message.state],
		error: message.state === 'failed' ? (message.failure?.message ?? NO_REASON) : null,
		at: message.at ?? null
	}));
}
