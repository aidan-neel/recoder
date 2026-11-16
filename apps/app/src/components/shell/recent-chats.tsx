'use client';

import { HoverList } from '@recoder/ui';
import { MessageSquare } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { useChatCache } from '@/lib/api/client';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { RecentChat } from '@/lib/shell/types';

import { RepoLabel } from '@/components/common/repo-label';

import { useChatActions } from './recent-actions';
import { RecentRow } from './recent-row';
import { SidebarSection } from './sidebar-section';

/**
 * The newest chats about a repository, so a conversation stays one click
 * away. It shows only once there is a chat: an empty list would only take
 * room from the reviews under it. Its title folds it away.
 */
export function RecentChats({ chats }: { chats: RecentChat[] }) {
	const pathname = usePathname();
	const chatCache = useChatCache();
	const actionsFor = useChatActions();

	const open = useSidebarFolds((state) => !state.folded.includes('chats'));
	const setOpen = useSidebarFolds((state) => state.setOpen);

	if (chats.length === 0) return null;

	return (
		<SidebarSection
			title="Chats"
			open={open}
			onOpenChange={(next) => setOpen('chats', next)}
			className="recent recent-chats"
		>
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
		</SidebarSection>
	);
}
