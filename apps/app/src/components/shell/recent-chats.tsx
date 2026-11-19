'use client';

import { Pill } from '@recoder/ui';
import { ChatIcon } from '@phosphor-icons/react';

import { useApi, useChatCache } from '@/lib/api/client';
import { useComposeMode } from '@/lib/compose/compose-mode';
import { shortAge } from '@/lib/shell/age';
import { useUnread } from '@/lib/shell/seen';
import { useSettleMarks } from '@/lib/shell/settle';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import { navigate, usePathname } from '@/lib/shell/navigation';
import { newReviewHref } from '@/lib/shell/routes';
import type { RecentChat } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { useChatActions } from './recent-actions';
import { AGE_TICK, ThreadRow } from './recent-row';
import { SidebarSection } from './sidebar-section';

/**
 * The newest chats about a repository that are not settled, so a
 * conversation stays one click away. It shows only once there is one: an
 * empty list would only take room from the lists around it. Its title folds it away, its + starts a new chat and its
 * ⋯ hides it.
 */
export function RecentChats({ chats }: { chats: RecentChat[] }) {
	const { base } = useApi();
	const pathname = usePathname();
	const chatCache = useChatCache();
	const actionsFor = useChatActions();
	const settle = useSettleMarks((state) => state.mark);
	const now = useNow(AGE_TICK);
	const shownRow = chats.find((chat) => pathname === chat.href);
	const unread = useUnread(shownRow && { id: shownRow.chatId, updatedAt: shownRow.updatedAt, busy: false });

	const open = useSidebarFolds((state) => !state.folded.includes('chats'));
	const setOpen = useSidebarFolds((state) => state.setOpen);
	const setShown = useSidebarFolds((state) => state.setShown);

	if (chats.length === 0) return null;

	return (
		<SidebarSection
			title="Chats"
			open={open}
			onOpenChange={(next) => setOpen('chats', next)}
			className="recent recent-chats"
			add={{ label: 'New chat', onSelect: () => newChat(base) }}
			onHide={() => setShown('chats', false)}
		>
			<div className="thread-list">
				{chats.map((chat) => {
					const fresh = unread(chat.chatId, chat.updatedAt);

					return (
						<ThreadRow
							key={chat.chatId}
							href={chat.href}
							active={pathname === chat.href}
							title={chat.title}
							age={shortAge(chat.updatedAt, now)}
							glyph={<ChatIcon aria-hidden />}
							place={
								<>
									<ChatIcon aria-hidden />
									<span className="thread-place-text">{chat.repoName}</span>
								</>
							}
							pill={
								fresh ? (
									<Pill tone="info" className="thread-pill">
										New reply
									</Pill>
								) : undefined
							}
							unread={fresh}
							actions={actionsFor(chat)}
							onIntent={() => chatCache.warm(chat.chatId)}
							onSettle={() => settle(chat.chatId, true)}
						/>
					);
				})}
			</div>
		</SidebarSection>
	);
}

/** Opens the New screen on Chat, for a chat about a repository. */
function newChat(base: string): void {
	useComposeMode.getState().setMode('chat');
	navigate(newReviewHref(base));
}
