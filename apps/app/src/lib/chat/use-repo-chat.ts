'use client';

import {
	MAX_CHAT_MESSAGE_CHARS,
	withRepoChatMessage,
	type ImageUpload,
	type RepoChat,
	type RepoChatEvent
} from '@recoder/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { useApi, useChatCache, useListStore, type ApiClient } from '../api/client';
import type { Connection } from '../api/event-stream';
import { ApiError, failureText } from '../api/http';
import { chatFailure } from '../ask/failure';
import { localId } from '../ask/local-id';
import { shortRepoName } from '../pulls/pull-rows';
import { pullHref } from '../shell/routes';
import type { ChatCache } from './chat-cache';
import { chatRows, isReplying, questionBefore, type Outgoing } from './chat-rows';
import type { RepoChatView } from './types';

type Loaded =
	{ phase: 'loading' } | { phase: 'ready'; chat: RepoChat } | { phase: 'missing' } | { phase: 'failed'; error: string };

const RECONNECTING = 'Reconnecting to the review server…';

/**
 * A chat with Recoder about a repository: it reads the chat, then follows
 * its events, so a reply streams in whether this page sent the question or
 * another did. What this page sends shows at once and stays until the
 * server's copy replaces it.
 */
export function useRepoChat(chatId: string): RepoChatView {
	const client = useApi();
	const chats = useChatCache();
	const list = useListStore();
	const repos = useStore(list.state, (data) => data.repos);
	const { loaded, connection, reload } = useFollowedChat(client, chats, chatId);
	const [outbox, setOutbox] = useState<Outgoing[]>([]);
	const [stopError, setStopError] = useState<string | null>(null);
	const chat = loaded.phase === 'ready' ? loaded.chat : null;
	const messages = useMemo(() => chat?.messages ?? [], [chat]);

	const reviewHref = useCallback(
		(prNumber: number) => pullHref(client.base, chat?.repoId ?? '', prNumber),
		[client.base, chat?.repoId]
	);

	const rows = useMemo(() => chatRows(messages, outbox, reviewHref), [messages, outbox, reviewHref]);

	const patch = useCallback((key: string, change: Partial<Outgoing>) => {
		setOutbox((current) => current.map((outgoing) => (outgoing.key === key ? { ...outgoing, ...change } : outgoing)));
	}, []);

	const send = useCallback(
		async (text: string, images: ImageUpload[] = []) => {
			const trimmed = text.trim();

			if (!trimmed) return;

			const key = localId('chat');
			const attached = images.length > 0 ? images : undefined;

			setStopError(null);

			setOutbox((current) => [
				...current,
				{ key, text: trimmed, state: 'pending', after: messages.length, images: attached }
			]);

			try {
				const sent = await client.sendRepoChat(chatId, { text: trimmed, images: attached });

				patch(key, { state: 'sent', serverId: sent.id });
			} catch (error) {
				patch(key, { state: 'failed', error: chatFailure(error).message });
			}
		},
		[client, chatId, patch, messages.length]
	);

	/** Stops the reply streaming now. Before the server's copy of it arrives there is nothing to stop yet. */
	const stop = useCallback(async () => {
		const open = messages.findLast((message) => message.from === 'assistant' && message.status === 'streaming');

		if (!open) return;

		try {
			setStopError(null);
			await client.stopRepoChat(chatId, open.id);
		} catch (error) {
			setStopError(`The reply did not stop. ${failureText(error)}`);
		}
	}, [client, chatId, messages]);

	/**
	 * Asks again: a refused message is sent once more, with its images; a failed reply's question is asked again,
	 * in words, since its images are already on the server.
	 */
	const retry = useCallback(
		(id: string) => {
			const index = rows.findIndex((row) => row.id === id);
			const question = rows[index]?.from === 'person' ? rows[index].text : questionBefore(rows, index);
			const refused = outbox.find((outgoing) => outgoing.key === id);

			setOutbox((current) => current.filter((outgoing) => outgoing.key !== id));
			if (question) void send(question, refused?.images);
		},
		[rows, outbox, send]
	);

	const ask = useMemo(
		() => ({
			messages: rows,
			replying: isReplying(messages, outbox),
			suggestions: [],
			limit: MAX_CHAT_MESSAGE_CHARS,
			send,
			stop: () => void stop(),
			retry
		}),
		[rows, messages, outbox, send, stop, retry]
	);

	return {
		phase: loaded.phase,
		error: loaded.phase === 'failed' ? loaded.error : null,
		repoId: chat?.repoId ?? null,
		title: chat?.title ?? null,
		repoName: chat && repos ? shortRepoName(repos, chat.repoId) : null,
		ask,
		note: chatNote(connection, stopError),
		reload
	};
}

/** The phase a chat's page starts in: its held copy when one was read before, else loading. */
function seeded(chats: ChatCache, chatId: string): Loaded {
	const held = chats.peek(chatId);

	return held ? { phase: 'ready', chat: held } : { phase: 'loading' };
}

/** A stop that failed says so first, since the person asked for it; then a stream on its way back. */
function chatNote(connection: Connection, stopError: string | null): RepoChatView['note'] {
	if (stopError) return { text: stopError, tone: 'danger' };
	if (connection === 'reconnecting') return { text: RECONNECTING, tone: 'neutral' };

	return null;
}

/**
 * The chat as the server last sent it. It is read once, then followed: the
 * stream opens on the whole chat and sends each message as it changes. When
 * the stream goes quiet or drops, the chat is read again, which also finds
 * out when it was deleted.
 */
function useFollowedChat(client: ApiClient, chats: ChatCache, chatId: string) {
	const [loaded, setLoaded] = useState<Loaded>(() => seeded(chats, chatId));
	const [connection, setConnection] = useState<Connection>('closed');
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let live = true;
		let stopFollowing: (() => void) | null = null;

		/** Reads the chat; says whether it is there to follow. A held copy shows while it loads. */
		async function read(): Promise<boolean> {
			const held = chats.peek(chatId);

			if (held) setLoaded((current) => (current.phase === 'ready' ? current : { phase: 'ready', chat: held }));

			try {
				const chat = await chats.read(chatId);

				if (live) setLoaded({ phase: 'ready', chat });

				return true;
			} catch (error) {
				if (!live) return false;

				if (error instanceof ApiError && error.status === 404) {
					setLoaded({ phase: 'missing' });
					chats.forget(chatId);
					stopFollowing?.();

					return false;
				}

				setLoaded((current) => (current.phase === 'ready' ? current : { phase: 'failed', error: failureText(error) }));

				return false;
			}
		}

		function apply(event: RepoChatEvent): void {
			if (event.type === 'snapshot') {
				setLoaded({ phase: 'ready', chat: event.chat });
				chats.keep(chatId, event.chat);
			}

			if (event.type === 'message')
				setLoaded((current) => {
					if (current.phase !== 'ready') return current;

					const chat = withRepoChatMessage(current.chat, event.message);

					chats.keep(chatId, chat);

					return { phase: 'ready', chat };
				});
		}

		void read().then((found) => {
			if (!live || !found) return;

			stopFollowing = client.followRepoChat(chatId, {
				onMessage: apply,
				onConnection: setConnection,
				onStale: () => void read()
			});
		});

		return () => {
			live = false;
			stopFollowing?.();
		};
	}, [client, chats, chatId, attempt]);

	const reload = useCallback(() => {
		setLoaded({ phase: 'loading' });
		setAttempt((current) => current + 1);
	}, []);

	return { loaded, connection, reload };
}
