'use client';

import type { Conversation } from '@recoder/shared';
import { Button, Icon, Pill, RowButton, ScrollArea, StatusNotice, Tooltip } from '@recoder/ui';

import { useDock } from '@/lib/messages/dock-store';
import { conversationPreview } from '@/lib/messages/preview';
import { displayName } from '@/lib/people/refs';
import { shortAge } from '@/lib/shell/age';
import { useNow } from '@/lib/shell/use-now';

import { Avatar } from '@/components/common/avatar';
import { AGE_TICK } from '@/components/shell/recent-row';

import { DockBadge } from './dock-badge';

interface InboxPanelProps {
	conversations: Conversation[];
	onNewMessage: () => void;
	onClose: () => void;
}

/**
 * Every conversation, newest first, in the launcher's window: who, when, and the newest message's first line, with
 * unread ones drawn bright and counted. A row opens that conversation in the same window. With none yet it offers
 * New message, which the header's + offers too. Focus starts on the newest row, so the keyboard lands inside.
 */
export function InboxPanel({ conversations, onNewMessage, onClose }: InboxPanelProps) {
	const openConversation = useDock((state) => state.openConversation);
	const now = useNow(AGE_TICK);

	return (
		<>
			<header className="dock-window-head">
				<h2 className="dock-window-title">Messages</h2>
				<Tooltip content="New message">
					<Button variant="ghost" size="icon" aria-label="New message" onClick={onNewMessage}>
						<Icon name="add" />
					</Button>
				</Tooltip>
				<Tooltip content="Close">
					<Button variant="ghost" size="icon" aria-label="Close messages" onClick={onClose}>
						<Icon name="close" />
					</Button>
				</Tooltip>
			</header>
			{conversations.length === 0 ? (
				<div className="dock-empty">
					<StatusNotice
						variant="inline"
						glyph={null}
						title="No conversations yet."
						actions={
							<Button autoFocus onClick={onNewMessage}>
								New message
							</Button>
						}
					/>
				</div>
			) : (
				<ScrollArea className="dock-scroll">
					<ul className="dock-inbox">
						{conversations.map((conversation, index) => {
							const name = displayName(conversation.with);

							return (
								<li key={conversation.id}>
									<RowButton
										className="dock-row"
										data-unread={conversation.unread > 0 || undefined}
										autoFocus={index === 0}
										onClick={() => openConversation(conversation.id, true)}
									>
										<Avatar name={name} src={conversation.with.avatarUrl} className="dock-row-avatar" />
										<span className="dock-row-text">
											<span className="dock-row-line">
												<span className="dock-row-name">{name}</span>
												{conversation.open ? null : <Pill tone="danger">Removed</Pill>}
												<span className="dock-row-age">
													{shortAge(conversation.lastMessage?.createdAt ?? conversation.updatedAt, now)}
												</span>
											</span>
											<span className="dock-row-line">
												<span className="dock-row-preview">{conversationPreview(conversation)}</span>
												<DockBadge count={conversation.unread} />
											</span>
										</span>
										{conversation.unread > 0 ? <span className="sr-only">{conversation.unread} unread</span> : null}
									</RowButton>
								</li>
							);
						})}
					</ul>
				</ScrollArea>
			)}
		</>
	);
}
