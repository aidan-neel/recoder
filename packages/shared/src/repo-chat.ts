import type { ImageUpload, StoredImage } from './attachments';
import type { ChatCitation, ChatTrailStep } from './chat-trail';
import type { ModelFailure } from './progress';

/**
 * One message of a conversation about a repository. A reply streams in as
 * `streaming`, then ends `done` (finished or stopped) or `error` (the model
 * failed, or its server went away).
 */
export interface RepoChatMessage {
	id: string;
	from: 'user' | 'assistant';
	/** Markdown for replies, plain text for the person's messages. */
	text: string;
	at: string;
	status: 'streaming' | 'done' | 'error';
	/** The model that wrote a reply. */
	model?: string;
	/** Set on a reply the person stopped; its text is what arrived before the stop. */
	stopped?: true;
	/** Set on a reply that could not finish. */
	failure?: ModelFailure;
	/** Set on a reply that started a review of a pull request, so the page can open it. */
	review?: { id: string; prNumber: number };
	/** The images the person attached to their message. */
	images?: StoredImage[];
	/** What a reply did before it answered: its reasoning and the files it read. Only what the model reports. */
	trail?: ChatTrailStep[];
	/** The passages of the repository the reply's citation links name. */
	citations?: ChatCitation[];
}

/** A conversation with Recoder about one tracked repository, oldest message first. */
export interface RepoChat {
	id: string;
	repoId: string;
	/** Short, from the first message. */
	title: string;
	/** The account that opened the chat, whose model picks it runs on; unset on chats stored before it was recorded, the admin's. */
	startedBy?: string;
	createdAt: string;
	updatedAt: string;
	messages: RepoChatMessage[];
}

/** A chat as a list shows it, without its messages. */
export type RepoChatSummary = Omit<RepoChat, 'messages'>;

export interface StartRepoChatInput {
	repoId: string;
	text: string;
	/** Images for the first message, at most `MAX_IMAGES`. */
	images?: ImageUpload[];
}

/** `POST /api/chats/:id/messages`: the next message, with any images. */
export interface SendRepoChatInput {
	text: string;
	/** At most `MAX_IMAGES`. */
	images?: ImageUpload[];
}

/**
 * One frame of a chat's event stream: the whole chat when the stream opens,
 * then each message as it is added or changes, and a heartbeat every few
 * seconds so the page can tell a quiet stream from a dropped one.
 */
export type RepoChatEvent =
	| { type: 'snapshot'; chat: RepoChat }
	| { type: 'message'; message: RepoChatMessage }
	| { type: 'heartbeat'; at: string };

/** The chat with `message` added, or put in place of the message with its id. */
export function withRepoChatMessage(chat: RepoChat, message: RepoChatMessage): RepoChat {
	const index = chat.messages.findIndex((existing) => existing.id === message.id);

	const messages =
		index < 0 ? [...chat.messages, message] : chat.messages.map((existing, at) => (at === index ? message : existing));

	return { ...chat, messages };
}
