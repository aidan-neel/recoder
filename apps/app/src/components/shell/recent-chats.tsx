'use client';

import { usePathname } from '@/lib/shell/navigation';

import { useChatCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { useSettleMarks } from '@/lib/shell/settle';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { RecentChat } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { RepoLabel } from '@/components/common/repo-label';

import { useChatActions } from './recent-actions';
import { AGE_TICK, RecentCard } from './recent-row';
import { SidebarSection } from './sidebar-section';

/**
 * The newest chats about a repository that are not settled, so a
 * conversation stays one click away. It shows only once there is one: an
 * empty list would only take room from the reviews under it. Its title folds it away.
 */
export function RecentChats({ chats }: { chats: RecentChat[] }) {
	const pathname = usePathname();
	const chatCache = useChatCache();
	const actionsFor = useChatActions();
	const settle = useSettleMarks((state) => state.mark);
	const now = useNow(AGE_TICK);

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
			<div className="recent-list">
				{chats.map((chat) => (
					<RecentCard
						key={chat.chatId}
						href={chat.href}
						active={pathname === chat.href}
						title={chat.title}
						repo={<RepoLabel name={chat.repoName} forge={chat.repoForge} />}
						age={shortAge(chat.updatedAt, now)}
						actions={actionsFor(chat)}
						onIntent={() => chatCache.warm(chat.chatId)}
						onSettle={() => settle(chat.chatId, true)}
					/>
				))}
			</div>
		</SidebarSection>
	);
}
