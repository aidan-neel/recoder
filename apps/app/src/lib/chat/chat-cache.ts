import type { RepoChat } from '@recoder/shared';

import type { ApiClient } from '../api/client';
import { keptReads, type KeptReads } from '../api/kept-reads';

/** Chats the app has read: returning to one paints its last copy while a fresh one loads. */
export type ChatCache = KeptReads<RepoChat>;

export function createChatCache(client: ApiClient): ChatCache {
	return keptReads((id) => client.repoChat(id));
}
