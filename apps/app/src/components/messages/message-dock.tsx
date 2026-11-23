'use client';

import type { Conversation } from '@recoder/shared';
import { Button, Icon, Tooltip } from '@recoder/ui';
import { AnimatePresence } from 'motion/react';
import { useRef, useState } from 'react';

import { useDock } from '@/lib/messages/dock-store';
import { useMessageDock, type Arrival } from '@/lib/messages/use-message-dock';
import { firstLine } from '@/lib/messages/preview';
import { displayName } from '@/lib/people/refs';

import { Avatar } from '@/components/common/avatar';

import { DockBadge } from './dock-badge';
import { DockWindow } from './dock-window';
import { NewMessageDialog } from './new-message-dialog';

/** What a head says to a screen reader: who, and how many messages wait. */
function headLabel(conversation: Conversation): string {
	const name = displayName(conversation.with);

	return conversation.unread > 0 ? `${name}, ${conversation.unread} unread` : name;
}

interface HeadProps {
	conversation: Conversation;
	open: boolean;
	pulse: Arrival | null;
	peek: Arrival | null;
}

/**
 * One person's bubble: their avatar with an unread count. Pressed, it raises their window, or folds it back when
 * it is open. A new message from them pulses it once, and peeks beside it while no window is open.
 */
function Head({ conversation, open, pulse, peek }: HeadProps) {
	const openConversation = useDock((state) => state.openConversation);
	const minimise = useDock((state) => state.minimise);
	const name = displayName(conversation.with);
	const mine = (arrival: Arrival | null) => (arrival?.conversationId === conversation.id ? arrival : null);
	const pulsing = mine(pulse);
	const peeking = mine(peek);

	return (
		<div className="dock-slot">
			<Tooltip content={name} side="left">
				<Button
					variant="ghost"
					size="icon"
					className="dock-bubble dock-head"
					data-dock-head={conversation.id}
					data-open={open || undefined}
					aria-label={headLabel(conversation)}
					aria-expanded={open}
					onClick={() => (open ? minimise() : openConversation(conversation.id))}
				>
					<Avatar name={name} src={conversation.with.avatarUrl} className="dock-avatar" />
					{pulsing ? <span key={pulsing.message.sequence} className="dock-pulse" aria-hidden /> : null}
					<DockBadge count={conversation.unread} />
				</Button>
			</Tooltip>
			{peeking ? (
				<p key={peeking.message.sequence} className="dock-peek" role="status">
					<span className="dock-peek-name">{name}</span>
					<span className="dock-peek-text">{firstLine(peeking.message)}</span>
				</p>
			) : null}
		</div>
	);
}

/**
 * Messages as floating bubbles at the window's bottom right, over every page: a launcher that opens every
 * conversation, and above it a head for each recent one, newest first. One window is open at a time and rises from
 * the bubble that opened it; Escape folds it back and hands focus to that bubble. Nothing shows until the inbox
 * answers, so a server without one has no dock.
 */
export function MessageDock() {
	const dock = useMessageDock();
	const toggleInbox = useDock((state) => state.toggleInbox);
	const root = useRef<HTMLDivElement>(null);
	const [picking, setPicking] = useState(false);

	if (!dock.ready) return null;

	const openId = dock.view?.kind === 'conversation' ? dock.view.conversationId : null;
	const inboxOpen = dock.view !== null && dock.origin === 'inbox';
	const place = dock.heads.findIndex((head) => head.id === dock.origin);

	/** Gives focus back to the bubble the window rose from, once the window has gone. */
	function returnFocus(origin: string): void {
		const selector = origin === 'inbox' ? '[data-dock-launcher]' : `[data-dock-head="${CSS.escape(origin)}"]`;

		requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());
	}

	return (
		<div ref={root} className="dock">
			<AnimatePresence>
				{dock.view ? (
					<DockWindow
						key={dock.origin}
						view={dock.view}
						conversations={dock.conversations}
						place={place}
						onNewMessage={() => setPicking(true)}
						onLeave={() => returnFocus(dock.origin)}
					/>
				) : null}
			</AnimatePresence>
			<div className="dock-bubbles" role="group" aria-label="Messages">
				<Tooltip content={inboxOpen ? 'Close messages' : 'Messages'} side="left">
					<Button
						variant="secondary"
						size="icon"
						className="dock-bubble dock-launcher"
						data-dock-launcher
						aria-label={dock.unread > 0 ? `Messages, ${dock.unread} unread` : 'Messages'}
						aria-expanded={inboxOpen}
						onClick={toggleInbox}
					>
						<Icon name={inboxOpen ? 'close' : 'chat_bubble'} />
						{inboxOpen ? null : <DockBadge count={dock.unread} />}
					</Button>
				</Tooltip>
				{dock.heads.map((conversation) => (
					<Head
						key={conversation.id}
						conversation={conversation}
						open={conversation.id === openId}
						pulse={dock.pulse}
						peek={dock.peek}
					/>
				))}
			</div>
			<NewMessageDialog open={picking} onOpenChange={setPicking} />
		</div>
	);
}
