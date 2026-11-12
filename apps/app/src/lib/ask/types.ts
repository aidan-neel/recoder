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
}

/** What a conversation is about: the whole pull request, or one finding of its review. */
export type AskScope = { kind: 'pull' } | { kind: 'bug'; bugId: string };

/** A conversation with Recoder about a pull request or one of its findings. Threads survive a reload. */
export interface AskView {
	/** Oldest first. */
	messages: AskMessageView[];
	/** True from sending until the reply ends or fails. */
	replying: boolean;
	/** Short questions to start from, shown while the thread is empty. */
	suggestions: string[];
	/** The longest message the server takes, in characters. */
	limit: number;
	/** Sends a question. On a pull request with no review yet, the first question opens a session for it. */
	send: (text: string) => Promise<void>;
	/** Stops the reply that is streaming. */
	stop: () => void;
	/** Asks again for the reply that failed. */
	retry: (messageId: string) => void;
}
