import type { RepoChat } from '@recoder/shared';

import type { ApiClient } from '../api/client';

export interface ChatCache {
	/** The chat as this app last saw it, or null before its first read. */
	peek(id: string): RepoChat | null;
	/** Reads the chat, sharing one request across callers; the answer is kept for `peek`. */
	read(id: string): Promise<RepoChat>;
	/** Starts the read, so the screen that opens the chat finds it partway or done. */
	warm(id: string): void;
	/** The newest copy of the chat a stream delivered; `peek` shows it. */
	keep(id: string, chat: RepoChat): void;
	/** Forgets the chat: deleted, or a read that found it gone. */
	forget(id: string): void;
}

/** Chats the app has read, kept so returning to one paints its last copy while a fresh one loads. */
export function createChatCache(client: ApiClient): ChatCache {
	const held = new Map<string, RepoChat>();
	const inflight = new Map<string, Promise<RepoChat>>();

	function read(id: string): Promise<RepoChat> {
		const pending = inflight.get(id);

		if (pending) return pending;

		const promise = client
			.repoChat(id)
			.then((chat) => {
				held.set(id, chat);

				return chat;
			})
			.finally(() => {
				if (inflight.get(id) === promise) inflight.delete(id);
			});

		inflight.set(id, promise);

		return promise;
	}

	return {
		peek: (id) => held.get(id) ?? null,
		read,

		warm(id) {
			void read(id).catch(() => undefined);
		},

		keep(id, chat) {
			held.set(id, chat);
		},

		forget(id) {
			held.delete(id);
		}
	};
}
