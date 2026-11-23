'use client';

import { HoverList, Icon, RowButton, SkeletonRows } from '@recoder/ui';
import { useCallback } from 'react';

import { useChatCache } from '@/lib/api/client';
import type { ComposeList } from '@/lib/compose/types';
import { useIntent } from '@/lib/shell/intent';
import type { RecentChat } from '@/lib/shell/types';

import { Age } from '@/components/common/age';
import { Link } from '@/components/common/link';
import { RepoLabel } from '@/components/common/repo-label';

import { ComposeEmpty, ComposeGroup } from './compose-group';

/** How many placeholder rows stand in while the chats load for the first time. */
const LOADING_ROWS = 3;

/** A chat row's height in px, which its placeholder shares. */
const ROW_HEIGHT = 48;

/** The newest chats over New's composer in Chat mode: a row opens its chat, and a new one starts in the composer. */
export function ChatList({ list }: { list: Pick<ComposeList, 'chats' | 'chatsLoading' | 'query' | 'repoId'> }) {
	if (list.chatsLoading) {
		return (
			<ComposeGroup title="Recent chats">
				<SkeletonRows count={LOADING_ROWS} height={ROW_HEIGHT} glyph rowClassName="compose-row" />
			</ComposeGroup>
		);
	}

	if (list.chats.length === 0) {
		const narrowed = list.query.trim() !== '' || list.repoId !== null;

		return narrowed ? <ComposeEmpty>No chat matches.</ComposeEmpty> : null;
	}

	return (
		<HoverList className="compose-groups" itemSelector="[data-chat]">
			<ComposeGroup title="Recent chats">
				{list.chats.map((chat) => (
					<ChatRow key={chat.chatId} chat={chat} />
				))}
			</ComposeGroup>
		</HoverList>
	);
}

/** One chat: its title over its repository and how long ago it last moved. Resting on it reads the chat ahead of the click. */
function ChatRow({ chat }: { chat: RecentChat }) {
	const chats = useChatCache();
	const intent = useIntent(useCallback(() => chats.warm(chat.chatId), [chats, chat.chatId]));

	return (
		<RowButton asChild data-chat className="compose-row">
			<Link href={chat.href} {...intent}>
				<Icon name="chat_bubble" className="compose-row-glyph" />
				<span className="compose-row-text">
					<span className="compose-row-name">{chat.title}</span>
					<span className="meta pull-meta">
						<RepoLabel name={chat.repoName} forge={chat.repoForge} />
						<Age at={chat.updatedAt} className="meta-sep" />
					</span>
				</span>
			</Link>
		</RowButton>
	);
}
