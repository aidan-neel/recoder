import { withRepoChatMessage, type RepoChatMessage, type RepoChatSummary } from '@recoder/shared';
import { storageNow } from '../storage/backend';
import { db } from '../store';
import {
	chatSummary,
	isAbandoned,
	MAX_CHAT_MESSAGES,
	withInterruptedReply,
	withTurn,
	type ChatTurn,
	type StoredRepoChat
} from './chat-record';

/**
 * A request the chat refuses, with the status the route answers. Every change
 * to a chat goes through one transactional `update` in this module, so
 * replicas that share PostgreSQL never overwrite each other.
 */
export class RepoChatError extends Error {
	constructor(
		message: string,
		readonly status: 404 | 409
	) {
		super(message);
		this.name = 'RepoChatError';
	}
}

/** What the writer of a reply does after saving it: carry on, stop, or give up because the reply is no longer its own. */
export type SaveOutcome = 'saved' | 'stop' | 'lost';

const listeners = new Map<string, Set<() => void>>();

/**
 * Calls `listener` after each change this server saves to the chat. Changes
 * saved on another replica do not call it; a stream finds those by reading
 * the chat again.
 */
export function subscribeRepoChat(chatId: string, listener: () => void): () => void {
	let set = listeners.get(chatId);

	if (!set) {
		set = new Set();
		listeners.set(chatId, set);
	}

	set.add(listener);

	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(chatId);
	};
}

function announce(chatId: string): void {
	for (const listener of listeners.get(chatId) ?? []) listener();
}

/** Saves a new chat that opens with `turn`. */
export async function openChat(chat: StoredRepoChat, turn: ChatTurn): Promise<StoredRepoChat> {
	return db.repoChats.set(withTurn(chat, turn, await storageNow()));
}

/** Adds the person's message and an open reply to the chat, unless a reply is still being written. */
export async function addTurn(chatId: string, turn: ChatTurn): Promise<StoredRepoChat> {
	const now = await storageNow();

	const next = await db.repoChats.update(chatId, (current) => {
		if (!current) throw new RepoChatError('Chat not found.', 404);

		const chat = closeAbandoned(current, now);

		if (chat.writer)
			throw new RepoChatError(
				'Recoder is still replying. Stop the reply or wait before you send another message.',
				409
			);
		if (chat.messages.length + 2 > MAX_CHAT_MESSAGES)
			throw new RepoChatError('This chat is full. Start a new one from New review.', 409);

		return withTurn(chat, turn, now);
	});

	if (!next) throw new RepoChatError('Chat not found.', 404);
	announce(chatId);

	return next;
}

/**
 * Saves the reply as it now stands, if it is still the chat's open reply. A
 * reply that is no longer `streaming` closes, and the chat has no writer
 * after it. Says what the writer does next.
 */
export async function saveReply(chatId: string, reply: RepoChatMessage): Promise<SaveOutcome> {
	const at = new Date(await storageNow()).toISOString();
	let outcome: SaveOutcome = 'lost';

	await db.repoChats.update(chatId, (current) => {
		if (!current?.writer || current.writer.messageId !== reply.id) return current;

		const open = reply.status === 'streaming';

		outcome = open && current.writer.stopRequested ? 'stop' : 'saved';

		return {
			...current,
			messages: withRepoChatMessage(current, reply).messages,
			updatedAt: at,
			writer: open ? { ...current.writer, heartbeatAt: at } : undefined
		};
	});

	if (outcome !== 'lost') announce(chatId);

	return outcome;
}

/**
 * Deletes the chat. A reply still being written finds its record gone at its next save and stops, wherever it is
 * written, and open event streams end. False when the chat was already gone.
 */
export async function deleteChat(chatId: string): Promise<boolean> {
	const deleted = await db.repoChats.delete(chatId);

	announce(chatId);

	return deleted;
}

/**
 * Asks the reply `messageId` to stop, wherever it is being written. False
 * when that reply is no longer open, so a late stop never stops the reply
 * of a newer message.
 */
export async function requestStop(chatId: string, messageId: string): Promise<boolean> {
	let open = false;

	await db.repoChats.update(chatId, (current) => {
		if (current?.writer?.messageId !== messageId) return current;

		open = true;

		return { ...current, writer: { ...current.writer, stopRequested: true } };
	});

	return open;
}

/**
 * The chat. A reply whose writer went quiet with its server is closed as
 * interrupted first, so no page waits on it for ever.
 */
export async function loadChat(chatId: string): Promise<StoredRepoChat | undefined> {
	const chat = await db.repoChats.get(chatId);

	if (!chat?.writer) return chat;

	const now = await storageNow();

	if (!isAbandoned(chat.writer, now)) return chat;

	const closed = await db.repoChats.update(chatId, (current) => current && closeAbandoned(current, now));

	announce(chatId);

	return closed;
}

/** The repository's chats, or every chat, most recently active first. */
export async function recentChats(repoId: string | undefined, limit: number): Promise<RepoChatSummary[]> {
	const chats = (await db.repoChats.list()).filter((chat) => repoId === undefined || chat.repoId === repoId);

	return chats
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, limit)
		.map(chatSummary);
}

/**
 * Closes every reply a previous server process left open. Only for a
 * standalone server: with shared storage another replica may still be
 * writing, and its replies close through `loadChat` once it goes quiet.
 */
export async function recoverRepoChats(): Promise<number> {
	let recovered = 0;

	for (const chat of await db.repoChats.list()) {
		if (!chat.writer) continue;

		await db.repoChats.update(chat.id, (current) =>
			current?.writer ? withInterruptedReply(current, new Date().toISOString()) : current
		);

		recovered++;
	}

	if (recovered > 0)
		console.warn(`[chat] closed ${recovered} repository chat repl${recovered === 1 ? 'y' : 'ies'} left open`);

	return recovered;
}

/** The chat with its reply closed as interrupted when its writer has been quiet too long by `now`, the storage clock. */
function closeAbandoned(chat: StoredRepoChat, now: number): StoredRepoChat {
	return chat.writer && isAbandoned(chat.writer, now) ? withInterruptedReply(chat, new Date(now).toISOString()) : chat;
}
