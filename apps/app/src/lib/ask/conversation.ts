import { ORCHESTRATOR_ID, type ReviewChatMessage } from '@recoder/shared';

import type { ChatFailure } from './failure';

/** A message sent from this page, shown at once and kept until the event stream carries the server's copy. */
export interface Outgoing {
	/** The row's key, kept after the server's copy arrives so the row never re-enters. */
	key: string;
	text: string;
	state: 'pending' | 'sent' | 'failed';
	/** How many messages the conversation had when this one was sent; its copy can only come after them. */
	after: number;
	/** The server's id for the message, once it accepted it. */
	serverId?: string;
	failure?: ChatFailure;
}

export type ConversationRow =
	{ kind: 'message'; key: string; message: ReviewChatMessage } | { kind: 'outgoing'; key: string; outgoing: Outgoing };

/** The main conversation: messages to and from Orchestrator, with reviewer threads it was copied on. */
export function orchestratorMessages(messages: ReviewChatMessage[] | undefined): ReviewChatMessage[] {
	return (messages ?? []).filter((message) => (message.assignmentId || ORCHESTRATOR_ID) === ORCHESTRATOR_ID);
}

/** True when a server message is the stream's copy of what this page sent. */
function isCopyOf(message: ReviewChatMessage, outgoing: Outgoing, index: number): boolean {
	return index >= outgoing.after && message.from === 'user' && !message.forwardedFrom && message.text === outgoing.text;
}

/**
 * Which outgoing message each server message stands for, by server id. A
 * message the server confirmed claims its copy by id. The server streams its
 * copy before it answers the send, so one still on its way claims the first
 * later user message with the same text.
 */
function copies(messages: ReviewChatMessage[], outbox: Outgoing[]): Map<string, string> {
	const owner = new Map(outbox.flatMap((outgoing) => (outgoing.serverId ? [[outgoing.serverId, outgoing.key]] : [])));

	for (const outgoing of outbox) {
		if (outgoing.serverId || outgoing.state === 'failed') continue;

		const copy = messages.find((message, index) => !owner.has(message.id) && isCopyOf(message, outgoing, index));

		if (copy) owner.set(copy.id, outgoing.key);
	}

	return owner;
}

/**
 * The transcript's rows: the server's messages in order, then what this page
 * sent that the stream has not carried yet. A server message that stands for
 * an outgoing one takes over its row key, so it shows once and never re-enters.
 */
export function conversationRows(messages: ReviewChatMessage[], outbox: Outgoing[]): ConversationRow[] {
	const owner = copies(messages, outbox);
	const carried = new Set(messages.flatMap((message) => owner.get(message.id) ?? []));

	return [
		...messages.map((message): ConversationRow => ({
			kind: 'message',
			key: owner.get(message.id) ?? message.id,
			message
		})),
		...outbox
			.filter((outgoing) => !carried.has(outgoing.key))
			.map((outgoing): ConversationRow => ({ kind: 'outgoing', key: outgoing.key, outgoing }))
	];
}

/** The reply Orchestrator is writing to the developer, if any; while it streams, Send becomes Stop. */
export function inFlightReply(messages: ReviewChatMessage[]): ReviewChatMessage | null {
	return (
		messages.findLast(
			(message) =>
				message.from === 'assistant' && message.discussion && !message.forwardedFrom && message.status === 'streaming'
		) ?? null
	);
}

/** The developer's own question in a row, sent or on its way; null for anything else, a reviewer thread they were copied on included. */
function questionOf(row: ConversationRow): string | null {
	if (row.kind === 'outgoing') return row.outgoing.text;

	return row.message.from === 'user' && !row.message.forwardedFrom ? row.message.text : null;
}

/**
 * The row where the developer last asked Orchestrator something, or -1. A
 * failed reply before it was already asked past, so it shows quietly.
 */
export function lastQuestionAt(rows: ConversationRow[]): number {
	return rows.findLastIndex((row) => questionOf(row) !== null);
}

/**
 * The question to ask again under the failed reply at `position`: the
 * developer's question before it. Only Orchestrator's own reply after their
 * latest question offers one, so a question that got its answer, or a
 * reviewer thread they were copied on, is never sent again.
 */
export function retryFor(rows: ConversationRow[], position: number): string | null {
	const row = rows[position];

	if (row?.kind !== 'message' || !row.message.failure || row.message.forwardedFrom) return null;
	if (position < lastQuestionAt(rows)) return null;

	const asked = rows.slice(0, position).findLast((before) => questionOf(before) !== null);

	return asked ? questionOf(asked) : null;
}
