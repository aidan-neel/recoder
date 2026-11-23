'use client';

import type { Conversation } from '@recoder/shared';
import { Pill } from '@recoder/ui';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { useApi, useInboxStore } from '@/lib/api/client';
import { displayName, messageHref } from '@/lib/people/refs';
import { shortAge } from '@/lib/shell/age';
import { usePathname } from '@/lib/shell/navigation';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import { useNow } from '@/lib/shell/use-now';

import { Avatar } from '@/components/common/avatar';
import { NewMessageDialog } from '@/components/messages/new-message-dialog';

import { AGE_TICK, ThreadRow } from './recent-row';
import { SidebarSection } from './sidebar-section';
import { ThreadItem, ThreadList } from './thread-list';

/** The newest message's first line, with "You:" before one the signed-in person sent. */
function preview(conversation: Conversation): string {
	const last = conversation.lastMessage;

	if (!last) return 'No messages yet';

	const words = last.body.trim().split('\n')[0] || (last.attachments.length > 0 ? 'Sent a pull request' : '');

	return last.authorId === conversation.with.accountId ? words : `You: ${words}`;
}

/**
 * The signed-in person's conversations, one row a person, newest message first. A row with messages they have not
 * read is drawn unread. It follows the inbox while the sidebar shows, so the rows and the tabs stay live, and shows
 * once the inbox answers: a server reached with the machine token has none. Its + picks someone to message.
 */
export function RecentMessages() {
	const { base } = useApi();
	const inbox = useInboxStore();
	const pathname = usePathname();
	const now = useNow(AGE_TICK);
	const conversations = useStore(inbox.state, (state) => state.conversations);
	const ready = useStore(inbox.state, (state) => state.phase === 'ready');
	const [picking, setPicking] = useState(false);

	const open = useSidebarFolds((state) => !state.folded.includes('messages'));
	const setOpen = useSidebarFolds((state) => state.setOpen);
	const setShown = useSidebarFolds((state) => state.setShown);

	useEffect(() => inbox.follow(), [inbox]);

	if (!ready) return null;

	return (
		<>
			<SidebarSection
				title="Messages"
				open={open}
				onOpenChange={(next) => setOpen('messages', next)}
				className="recent recent-messages"
				add={{ label: 'New message', onSelect: () => setPicking(true) }}
				onHide={() => setShown('messages', false)}
			>
				{conversations.length === 0 ? <p className="recent-empty">Message someone on this server with +.</p> : null}
				<ThreadList>
					{conversations.map((conversation) => {
						const href = messageHref(base, conversation.id);
						const name = displayName(conversation.with);
						const avatar = <Avatar name={name} src={conversation.with.avatarUrl} className="thread-avatar" />;

						return (
							<ThreadItem key={conversation.id}>
								<ThreadRow
									href={href}
									active={pathname === href}
									title={name}
									age={shortAge(conversation.lastMessage?.createdAt ?? conversation.updatedAt, now)}
									glyph={avatar}
									place={<span className="thread-place-text">{preview(conversation)}</span>}
									pill={
										conversation.open ? undefined : (
											<Pill tone="danger" className="thread-pill">
												Removed
											</Pill>
										)
									}
									status={conversation.unread > 0 ? `${conversation.unread} unread` : undefined}
									unread={conversation.unread > 0}
								/>
							</ThreadItem>
						);
					})}
				</ThreadList>
			</SidebarSection>
			<NewMessageDialog open={picking} onOpenChange={setPicking} />
		</>
	);
}
