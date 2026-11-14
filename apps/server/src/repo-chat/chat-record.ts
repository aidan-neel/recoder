import type { RepoChat, RepoChatMessage, RepoChatSummary, StoredImage } from '@recoder/shared';

/**
 * Who is writing a chat's reply. Only one reply is open at a time. The writer
 * reports every `WRITER_HEARTBEAT_MS`, and every report reads `stopRequested`,
 * so a stop sent to any replica reaches the replica that writes.
 */
export interface ChatWriter {
	messageId: string;
	heartbeatAt: string;
	stopRequested: boolean;
}

/** A chat as stored: what the page reads, plus the writer of its open reply. */
export interface StoredRepoChat extends RepoChat {
	writer?: ChatWriter;
}

/** A writer reports at least this often while its reply is open. */
export const WRITER_HEARTBEAT_MS = 1000;

/** A writer silent this long has gone with its server, so any replica may close its reply. */
export const WRITER_STALE_MS = 30_000;

/**
 * A chat takes no more messages past this. A streamed reply rewrites the
 * chat's record several times a second, so the record must stay small.
 */
export const MAX_CHAT_MESSAGES = 200;

/** Reply text past this is cut, the same as a review's messages. */
export const MAX_REPLY_CHARS = 64_000;

const TITLE_CHARS = 60;

/** What a closed abandoned reply says, in place of a model failure. */
export const INTERRUPTED = 'The reply was interrupted before it finished. Ask again.';

/** A short title from the first message: its first line, cut at a word near `TITLE_CHARS`. */
export function chatTitle(text: string): string {
	const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');

	if (line.length <= TITLE_CHARS) return line;

	const cut = line.slice(0, TITLE_CHARS);
	const space = cut.lastIndexOf(' ');

	return `${space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut}…`;
}

/** A new chat with no messages yet, opened by the account `startedBy`, whose model picks its replies use. */
export function newChat(repoId: string, title: string, at: string, startedBy: string): StoredRepoChat {
	return { id: crypto.randomUUID(), repoId, title, startedBy, createdAt: at, updatedAt: at, messages: [] };
}

/** The person's message and the empty reply that answers it. */
export interface ChatTurn {
	user: RepoChatMessage;
	reply: RepoChatMessage;
}

export function newTurn(text: string, model: string, at: string): ChatTurn {
	return {
		user: { id: crypto.randomUUID(), from: 'user', text, at, status: 'done' },
		reply: { id: crypto.randomUUID(), from: 'assistant', text: '', at, status: 'streaming', model }
	};
}

/** The turn with `images` on the person's message, or as it is when there are none. */
export function withImages(turn: ChatTurn, images: StoredImage[]): ChatTurn {
	return images.length ? { ...turn, user: { ...turn.user, images } } : turn;
}

/** The chat with `turn` added and its reply's writer set, its first heartbeat at `now` by the storage clock. */
export function withTurn(chat: StoredRepoChat, turn: ChatTurn, now: number): StoredRepoChat {
	const at = new Date(now).toISOString();

	return {
		...chat,
		messages: [...chat.messages, turn.user, turn.reply],
		updatedAt: at,
		writer: { messageId: turn.reply.id, heartbeatAt: at, stopRequested: false }
	};
}

/**
 * True when the writer stopped reporting long enough ago that its server must
 * be gone. `now` and the heartbeat both come from the storage clock, so a
 * replica whose own clock runs ahead does not close a live reply.
 */
export function isAbandoned(writer: ChatWriter, now: number): boolean {
	return now - Date.parse(writer.heartbeatAt) > WRITER_STALE_MS;
}

/** The chat with its open reply closed as interrupted, keeping what it had written, and no writer. */
export function withInterruptedReply(chat: StoredRepoChat, at: string): StoredRepoChat {
	const { writer: _writer, ...rest } = chat;

	return {
		...rest,
		updatedAt: at,
		messages: chat.messages.map((message) =>
			message.status === 'streaming' ? { ...message, status: 'error', failure: { reason: INTERRUPTED } } : message
		)
	};
}

/** The chat as the page reads it, without its writer. */
export function publicChat(chat: StoredRepoChat): RepoChat {
	const { writer: _writer, ...rest } = chat;

	return rest;
}

export function chatSummary(chat: StoredRepoChat): RepoChatSummary {
	return {
		id: chat.id,
		repoId: chat.repoId,
		title: chat.title,
		...(chat.startedBy !== undefined ? { startedBy: chat.startedBy } : {}),
		createdAt: chat.createdAt,
		updatedAt: chat.updatedAt
	};
}
