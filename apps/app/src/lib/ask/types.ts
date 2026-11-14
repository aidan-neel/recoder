import type { ChatCitation, ChatTrailStep, ImageUpload } from '@recoder/shared';
import type { ComposerCommand, ImageChip } from '@recoder/ui';

/** One message of a conversation with Recoder. */
export interface AskMessageView {
	id: string;
	from: 'person' | 'recoder';
	/** Markdown for Recoder's replies, plain text for the person's. */
	text: string;
	/** `writing` while the reply streams in. */
	state: 'done' | 'writing' | 'failed';
	/** Why the reply failed, as one plain sentence. */
	error: string | null;
	/** ISO time; null for a message not sent yet. */
	at: string | null;
	/** The images the person attached, as chips that open them. */
	images?: ImageChip[];
	/** What a reply did before it answered; present on a repository chat's replies, empty when it reported nothing. */
	trail?: ChatTrailStep[];
	/** The passages of the repository the reply's citation links name. */
	citations?: ChatCitation[];
}

/** What a conversation is about: the whole pull request, or one finding of its review. */
export type AskScope = { kind: 'pull' } | { kind: 'bug'; bugId: string };

/** A conversation with Recoder about a pull request or one of its findings. Threads survive a reload. */
export interface AskView {
	/** Oldest first. */
	messages: AskMessageView[];
	/** True from sending until the reply ends or fails. */
	replying: boolean;
	/**
	 * Short questions to start from, shown while the thread is empty. None while the review's earlier
	 * conversation is still arriving, so they never flash before it.
	 */
	suggestions: string[];
	/** What "/" offers in the composer: only what this conversation can do now. None leaves out the "/". */
	commands?: ComposerCommand[];
	/** The longest message the server takes, in characters. */
	limit: number;
	/**
	 * Sends a question, with `images` where the conversation takes them (a repository chat). On a pull request
	 * with no review yet, the first question opens a session for it.
	 */
	send: (text: string, images?: ImageUpload[]) => Promise<void>;
	/** Stops the reply that is streaming. */
	stop: () => void;
	/** Asks again for the reply that failed. */
	retry: (messageId: string) => void;
}
