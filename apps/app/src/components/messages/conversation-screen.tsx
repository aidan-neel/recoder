'use client';

import { MESSAGE_MAX_LENGTH, type Conversation } from '@recoder/shared';
import { Button, focusComposerField, ForgeMark, Pill, StatusNotice, Icon } from '@recoder/ui';
import { useEffect, useRef } from 'react';

import { useAccountView } from '@/lib/account/use-account-menu';
import { useApi } from '@/lib/api/client';
import { useFollowEnd } from '@/lib/ask/use-follow-end';
import { useConversation, type ConversationView } from '@/lib/messages/use-conversation';
import { displayName, personHref } from '@/lib/people/refs';

import { ChatComposer } from '@/components/ask/chat-composer';
import { ChatSkeleton } from '@/components/chat/chat-conversation';
import { Avatar } from '@/components/common/avatar';
import { Crumbs } from '@/components/common/crumbs';
import { Link } from '@/components/common/link';
import { Page } from '@/components/common/page';

import { ConversationThread } from './conversation-thread';
import { PullChip } from './pull-chip';

/** Who the conversation is with, over the thread: their avatar, name and handle, and a way to their profile. */
function ConversationHead({ conversation }: { conversation: Conversation }) {
	const { base } = useApi();
	const person = conversation.with;
	const name = displayName(person);

	return (
		<header className="dm-head">
			<Avatar name={name} src={person.avatarUrl} className="dm-head-avatar" />
			<div className="dm-head-title">
				<span className="dm-head-name">
					{name}
					{conversation.open ? null : <Pill tone="danger">Removed from this server</Pill>}
				</span>
				<span className="person-handle">
					<ForgeMark provider={person.provider} aria-hidden />@{person.login}
				</span>
			</div>
			<Button asChild variant="outline">
				<Link href={personHref(base, person)}>
					<Icon name="person" />
					Profile
				</Link>
			</Button>
		</header>
	);
}

/**
 * The foot of the page: the pull requests waiting to go, then the composer, or why the conversation takes no replies.
 * The composer takes focus when the page opens, so a conversation opened from a profile or a pull request is ready
 * to write in.
 */
function ConversationDock({
	view,
	conversation,
	away,
	toEnd
}: {
	view: ConversationView;
	conversation: Conversation;
	away: boolean;
	toEnd: () => void;
}) {
	const name = displayName(conversation.with);
	const dock = useRef<HTMLDivElement>(null);

	useEffect(() => {
		focusComposerField(dock.current?.querySelector('[data-ui="composer"]') ?? null);
	}, []);

	/** Sends, and brings the end into view so the message shows going. */
	async function send(text: string): Promise<void> {
		toEnd();
		await view.send(text);
	}

	return (
		<div ref={dock} className="page-column chat-dock dm-dock">
			<div className="chat-dock-column">
				{away ? (
					<Button variant="secondary" className="chat-to-end" onClick={toEnd}>
						<Icon name="arrow_downward" />
						Scroll to end
					</Button>
				) : null}
				{conversation.open ? (
					<>
						{view.attachments.length > 0 ? (
							<div className="dm-draft-attachments">
								{view.attachments.map((attachment) => (
									<PullChip
										key={`${attachment.repoId}#${attachment.number}`}
										attachment={attachment}
										onRemove={() => view.detach(attachment)}
									/>
								))}
							</div>
						) : null}
						<ChatComposer
							label={`Message ${name}`}
							placeholder={`Message ${name}`}
							minRows={1}
							limit={MESSAGE_MAX_LENGTH}
							onSend={send}
						/>
					</>
				) : (
					<StatusNotice
						variant="inline"
						title={`${name} was removed from this server, so the conversation takes no replies.`}
						className="dm-closed"
					/>
				)}
			</div>
		</div>
	);
}

/** The conversation once it is in: the thread, which follows what arrives while its end is in view, over the dock. */
function ConversationBody({ view, conversation }: { view: ConversationView; conversation: Conversation }) {
	const account = useAccountView('You');
	const { scroller, away, toEnd } = useFollowEnd(false);

	return (
		<>
			<div ref={scroller} className="chat-scroll">
				<div className="page-column chat-thread dm-column">
					<ConversationHead conversation={conversation} />
					<ConversationThread view={view} conversation={conversation} me={account} />
				</div>
			</div>
			<ConversationDock view={view} conversation={conversation} away={away} toEnd={toEnd} />
		</>
	);
}

/**
 * A direct message conversation with one person on this server, in the chat page's reading column: who it is with,
 * the messages, and a composer docked at the foot. One that is not the signed-in person's, or is gone, reads as
 * missing; one that did not load says so with Try again.
 */
export function ConversationScreen({ conversationId }: { conversationId: string }) {
	const view = useConversation(conversationId);
	const { conversation } = view;
	const name = conversation ? displayName(conversation.with) : null;

	return (
		<Page start={<Crumbs parts={name ? [{ label: 'Messages' }, { label: name }] : [{ label: 'Messages' }]} />}>
			{view.phase === 'missing' ? (
				<div className="page-notice">
					<StatusNotice
						variant="banner"
						heading="h1"
						glyph={<Icon name="chat_bubble_off" />}
						title="This conversation does not exist."
						detail="The link may be old or mistyped, or the conversation is someone else’s."
					/>
				</div>
			) : null}
			{view.phase === 'failed' ? (
				<div className="page-notice">
					<StatusNotice
						tone="danger"
						heading="h1"
						title="The conversation did not load."
						detail={view.error}
						actions={
							<Button onClick={view.retry}>
								<Icon name="replay" />
								Try again
							</Button>
						}
					/>
				</div>
			) : null}
			{view.phase === 'loading' ? <ChatSkeleton /> : null}
			{view.phase === 'ready' && conversation ? <ConversationBody view={view} conversation={conversation} /> : null}
		</Page>
	);
}
