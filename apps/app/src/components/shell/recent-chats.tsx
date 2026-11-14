'use client';

import { HoverList } from '@recoder/ui';
import { MessageSquare } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { useChatCache } from '@/lib/api/client';
import type { RecentChat } from '@/lib/shell/types';

import { RepoLabel } from '@/components/common/repo-label';

import { useChatActions } from './recent-actions';
import { RecentRow } from './recent-row';

/**
 * The newest chats about a repository, so a conversation stays one click
 * away. It shows only once there is a chat: an empty list would only take
 * room from the reviews under it.
 */
export function RecentChats({ chats }: { chats: RecentChat[] }) {
	const pathname = usePathname();
	const chatCache = useChatCache();
	const actionsFor = useChatActions();

	if (chats.length === 0) return null;

	return (
		<section className="recent recent-chats" aria-label="Chats">
			<h2 className="section-label recent-label">Chats</h2>
			<HoverList className="recent-list" itemSelector="[data-recent]">
				{chats.map((chat) => (
					<RecentRow
						key={chat.chatId}
						href={chat.href}
						active={pathname === chat.href}
						mark={<MessageSquare aria-hidden className="recent-mark" />}
						title={chat.title}
						actions={actionsFor(chat)}
						onIntent={() => chatCache.warm(chat.chatId)}
						meta={<RepoLabel name={chat.repoName} forge={chat.repoForge} />}
					/>
				))}
			</HoverList>
		</section>
	);
}
