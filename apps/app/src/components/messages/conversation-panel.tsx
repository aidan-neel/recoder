'use client';

import { MESSAGE_MAX_LENGTH, type Conversation } from '@recoder/shared';
import {
	Button,
	focusComposerField,
	ForgeMark,
	Icon,
	ScrollArea,
	SkeletonText,
	StatusNotice,
	Tooltip
} from '@recoder/ui';
import { useEffect, useRef } from 'react';

import { useAccountView } from '@/lib/account/use-account-menu';
import { useApi } from '@/lib/api/client';
import { useFollowEnd } from '@/lib/ask/use-follow-end';
import { useDock } from '@/lib/messages/dock-store';
import { useConversation, type ConversationView } from '@/lib/messages/use-conversation';
import { displayName, personHref } from '@/lib/people/refs';

import { ChatComposer } from '@/components/ask/chat-composer';
import { Avatar } from '@/components/common/avatar';
import { Link } from '@/components/common/link';

import { ConversationThread } from './conversation-thread';
import { PullChip } from './pull-chip';

interface WindowControls {
	onMinimise: () => void;
	onClose: () => void;
}

/** The window's head: back to every conversation, who it is with (a link to their profile), minimise and close. */
function ConversationHead({
	conversation,
	onMinimise,
	onClose
}: WindowControls & { conversation: Conversation | null }) {
	const { base } = useApi();
	const back = useDock((state) => state.back);
	const person = conversation?.with ?? null;
	const name = person ? displayName(person) : null;

	return (
		<header className="dock-window-head">
			<Tooltip content="All messages">
				<Button variant="ghost" size="icon" aria-label="All messages" onClick={back}>
					<Icon name="arrow_back" />
				</Button>
			</Tooltip>
			{person && name ? (
				<Link href={personHref(base, person)} className="dock-person">
					<Avatar name={name} src={person.avatarUrl} className="dock-person-avatar" />
					<span className="dock-window-title">{name}</span>
					<span className="person-handle">
						<ForgeMark provider={person.provider} aria-hidden />@{person.login}
					</span>
				</Link>
			) : (
				<span className="dock-person" />
			)}
			<Tooltip content="Minimise">
				<Button variant="ghost" size="icon" aria-label="Minimise" onClick={onMinimise}>
					<Icon name="remove" />
				</Button>
			</Tooltip>
			<Tooltip content="Close">
				<Button variant="ghost" size="icon" aria-label="Close conversation" onClick={onClose}>
					<Icon name="close" />
				</Button>
			</Tooltip>
		</header>
	);
}

/**
 * The window's foot: the pull requests waiting to go, then the composer, or why the conversation takes no replies.
 * The composer takes focus as the window opens, so a conversation opened from a head, a profile or a pull request is
 * ready to write in.
 */
function ConversationFoot({
	view,
	conversation,
	toEnd
}: {
	view: ConversationView;
	conversation: Conversation;
	toEnd: () => void;
}) {
	const name = displayName(conversation.with);
	const foot = useRef<HTMLDivElement>(null);

	useEffect(() => {
		focusComposerField(foot.current?.querySelector('[data-ui="composer"]') ?? null);
	}, []);

	/** Sends, and brings the end into view so the message shows going. */
	async function send(text: string): Promise<void> {
		toEnd();
		await view.send(text);
	}

	if (!conversation.open)
		return (
			<div className="dock-foot">
				<StatusNotice
					variant="inline"
					title={`${name} was removed from this server, so the conversation takes no replies.`}
				/>
			</div>
		);

	return (
		<div ref={foot} className="dock-foot">
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
		</div>
	);
}

/** The conversation once it is in: the thread, which follows what arrives while its end is in view, over the foot. */
function ConversationBody({ view, conversation }: { view: ConversationView; conversation: Conversation }) {
	const account = useAccountView('You');
	const { scroller, away, toEnd } = useFollowEnd(false);

	return (
		<>
			<ScrollArea className="dock-scroll" viewportRef={scroller}>
				<ConversationThread view={view} conversation={conversation} me={account} />
			</ScrollArea>
			{away ? (
				<Button variant="secondary" className="dock-to-end" onClick={toEnd}>
					<Icon name="arrow_downward" />
					Scroll to end
				</Button>
			) : null}
			<ConversationFoot view={view} conversation={conversation} toEnd={toEnd} />
		</>
	);
}

/**
 * One conversation in the floating window: who it is with, the messages as chat bubbles, and the composer at the
 * foot. One that is gone reads as missing; one that did not load says so with Try again.
 */
export function ConversationPanel({
	conversationId,
	onMinimise,
	onClose
}: WindowControls & { conversationId: string }) {
	const view = useConversation(conversationId);
	const { conversation } = view;

	return (
		<>
			<ConversationHead conversation={conversation} onMinimise={onMinimise} onClose={onClose} />
			{view.phase === 'loading' ? <SkeletonText lineHeight={36} count={4} className="dock-skeleton" /> : null}
			{view.phase === 'missing' ? (
				<div className="dock-empty">
					<StatusNotice
						variant="inline"
						glyph={<Icon name="chat_bubble_off" />}
						title="This conversation does not exist."
						detail="It may be someone else’s, or it was removed."
					/>
				</div>
			) : null}
			{view.phase === 'failed' ? (
				<div className="dock-empty">
					<StatusNotice
						tone="danger"
						variant="inline"
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
			{view.phase === 'ready' && conversation ? <ConversationBody view={view} conversation={conversation} /> : null}
		</>
	);
}
