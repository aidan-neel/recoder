import type { AskView } from '../ask/types';

/** A chat with Recoder about one repository, as its page shows it. */
export interface RepoChatView {
	/** `missing` when the server has no such chat; `failed` when it could not be read. */
	phase: 'loading' | 'ready' | 'missing' | 'failed';
	/** Why the chat did not load. */
	error: string | null;
	/** The repository the chat is about; null until the chat loads. */
	repoId: string | null;
	/** Short, from the first message; null until the chat loads. */
	title: string | null;
	/** The repository's short name, once the tracked list is known. */
	repoName: string | null;
	/** The thread and what the composer does: send, stop, ask again. */
	ask: AskView;
	/** One line over the composer: that the stream is reconnecting, or, as a failure, why a stop failed. */
	note: { text: string; tone: 'neutral' | 'danger' } | null;
	/** Reads the chat again after it failed to load. */
	reload: () => void;
}
