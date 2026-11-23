'use client';

import type { Conversation, ConversationPage, DirectMessage, PullAttachment } from '@recoder/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useApi, useInboxStore } from '../api/client';
import { ApiError, failureText } from '../api/http';
import { useDraftAttachments } from './draft-attachments';

/** A message on its way: shown at once, and kept with Retry when the server refuses it, so nothing typed is lost. */
export interface OutgoingMessage {
	clientId: string;
	body: string;
	attachments: PullAttachment[];
	state: 'sending' | 'failed';
	error: string | null;
	createdAt: string;
}

export interface ConversationView {
	phase: 'loading' | 'ready' | 'missing' | 'failed';
	conversation: Conversation | null;
	/** Every message read or received, oldest first. */
	messages: DirectMessage[];
	outgoing: OutgoingMessage[];
	/** True while older messages are still on the server. */
	hasOlder: boolean;
	loadingOlder: boolean;
	loadOlder: () => void;
	error: string | null;
	retry: () => void;
	/** The pull requests waiting to go with the next message. */
	attachments: PullAttachment[];
	detach: (attachment: PullAttachment) => void;
	/** Sends the words with the waiting attachments; resolves once the message is on its way. */
	send: (text: string) => Promise<void>;
	resend: (clientId: string) => void;
}

const NO_MESSAGES: DirectMessage[] = [];
const NO_ATTACHMENTS: PullAttachment[] = [];

/** Messages by sequence, each once, oldest first. */
function merged(...lists: DirectMessage[][]): DirectMessage[] {
	const bySequence = new Map<number, DirectMessage>();

	for (const list of lists) for (const message of list) bySequence.set(message.sequence, message);

	return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

/** True when the person is looking at this page: the tab on screen and the window focused. */
function isWatching(): boolean {
	return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * One conversation: its newest page, older pages on request, messages arriving live from the inbox, and sends that
 * show at once. While the person is looking, everything the other person wrote is marked read.
 */
export function useConversation(conversationId: string): ConversationView {
	const client = useApi();
	const inbox = useInboxStore();
	const live = useStore(inbox.state, (state) => state.conversations.find((item) => item.id === conversationId) ?? null);
	const arrivals = useStore(inbox.state, (state) => state.arrivals[conversationId] ?? NO_MESSAGES);
	const attachments = useDraftAttachments((state) => state.byConversation[conversationId] ?? NO_ATTACHMENTS);
	const detachOne = useDraftAttachments((state) => state.remove);
	const clearAttachments = useDraftAttachments((state) => state.clear);

	const [page, setPage] = useState<ConversationPage | null>(null);
	const [phase, setPhase] = useState<ConversationView['phase']>('loading');
	const [error, setError] = useState<string | null>(null);
	const [older, setOlder] = useState<{ messages: DirectMessage[]; before: number | null } | null>(null);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [sent, setSent] = useState<DirectMessage[]>([]);
	const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
	const [attempt, setAttempt] = useState(0);
	const readThrough = useRef(0);

	useEffect(() => {
		let current = true;

		client.messages.page(conversationId).then(
			(answer) => {
				if (!current) return;

				setPage(answer);
				setPhase('ready');
			},
			(failure: unknown) => {
				if (!current) return;

				setPhase(failure instanceof ApiError && failure.status === 404 ? 'missing' : 'failed');
				setError(failureText(failure));
			}
		);

		return () => {
			current = false;
		};
	}, [client, conversationId, attempt]);

	const conversation = live ?? page?.conversation ?? null;

	const messages = useMemo(
		() => merged(older?.messages ?? NO_MESSAGES, page?.messages ?? NO_MESSAGES, sent, arrivals),
		[older, page, sent, arrivals]
	);

	const landed = useMemo(() => new Set(messages.map((message) => message.clientId)), [messages]);
	const pending = useMemo(() => outgoing.filter((item) => !landed.has(item.clientId)), [outgoing, landed]);
	const before = older ? older.before : (page?.before ?? null);

	const theirLast = useMemo(() => {
		const theirs = messages.filter((message) => message.authorId === conversation?.with.accountId);

		return theirs.at(-1)?.sequence ?? 0;
	}, [messages, conversation]);

	useEffect(() => {
		if (!conversation || phase !== 'ready') return;

		/** Marks what they wrote as read once, while the person is looking. */
		function markRead(): void {
			if (!conversation || !isWatching()) return;

			const through = Math.max(theirLast, conversation.lastSequence);

			if (through <= conversation.readSequence || through <= readThrough.current) return;

			readThrough.current = through;

			void client.messages.read(conversationId, through).then(inbox.keep, () => {
				readThrough.current = 0;
			});
		}

		markRead();
		window.addEventListener('focus', markRead);
		document.addEventListener('visibilitychange', markRead);

		return () => {
			window.removeEventListener('focus', markRead);
			document.removeEventListener('visibilitychange', markRead);
		};
	}, [client, inbox, conversation, conversationId, phase, theirLast]);

	const deliver = useCallback(
		(message: OutgoingMessage) => {
			setOutgoing((list) => [
				...list.filter((item) => item.clientId !== message.clientId),
				{ ...message, state: 'sending', error: null }
			]);

			client.messages
				.send(conversationId, { clientId: message.clientId, body: message.body, attachments: message.attachments })
				.then(
					(saved) => setSent((list) => [...list, saved]),
					(failure: unknown) =>
						setOutgoing((list) =>
							list.map((item) =>
								item.clientId === message.clientId ? { ...item, state: 'failed', error: failureText(failure) } : item
							)
						)
				);
		},
		[client, conversationId]
	);

	const send = useCallback(
		async (text: string) => {
			deliver({
				clientId: crypto.randomUUID(),
				body: text,
				attachments,
				state: 'sending',
				error: null,
				createdAt: new Date().toISOString()
			});

			clearAttachments(conversationId);
		},
		[deliver, attachments, clearAttachments, conversationId]
	);

	const resend = useCallback(
		(clientId: string) => {
			const message = outgoing.find((item) => item.clientId === clientId);

			if (message) deliver(message);
		},
		[outgoing, deliver]
	);

	const loadOlder = useCallback(() => {
		if (before === null || loadingOlder) return;

		setLoadingOlder(true);

		client.messages.page(conversationId, before).then(
			(answer) => {
				setOlder((held) => ({
					messages: merged(answer.messages, held?.messages ?? NO_MESSAGES),
					before: answer.before
				}));

				setLoadingOlder(false);
			},
			() => setLoadingOlder(false)
		);
	}, [before, loadingOlder, client, conversationId]);

	const retry = useCallback(() => {
		setPhase('loading');
		setError(null);
		setAttempt((count) => count + 1);
	}, []);

	return {
		phase,
		conversation,
		messages,
		outgoing: pending,
		hasOlder: before !== null,
		loadingOlder,
		loadOlder,
		error,
		retry,
		attachments,
		detach: (attachment) => detachOne(conversationId, attachment),
		send,
		resend
	};
}
