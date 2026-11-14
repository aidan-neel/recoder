import type { Repo, RepoChatSummary } from '@recoder/shared';

import { isConnectedRepo, repoForge, shortRepoName } from '../pulls/pull-rows';
import { chatHref } from './routes';
import type { RecentChat } from './types';

/** The sidebar's rows for the newest chats in connected repos, in the order the server sent them. */
export function recentChats(chats: RepoChatSummary[], repos: Repo[] | null, base: string): RecentChat[] {
	return chats
		.filter((chat) => isConnectedRepo(repos, chat.repoId))
		.map((chat) => ({
			chatId: chat.id,
			href: chatHref(base, chat.id),
			title: chat.title,
			repoName: shortRepoName(repos, chat.repoId),
			repoForge: repoForge(repos, chat.repoId)
		}));
}
