'use client';

import type { Conversation } from '@recoder/shared';
import { DURATION, EASE_OUT, useMotionVariants } from '@recoder/ui';
import { motion, type Variants } from 'motion/react';
import type { KeyboardEvent } from 'react';

import { useDock, type DockView } from '@/lib/messages/dock-store';
import { displayName } from '@/lib/people/refs';

import { ConversationPanel } from './conversation-panel';
import { InboxPanel } from './inbox-panel';

/** The window rises from its bubble: up from a 0.9 scale and 8px lower, on the menus' timing. */
const windowMotion: Variants = {
	closed: { opacity: 0, scale: 0.9, y: 8, transition: { duration: DURATION.menuOut, ease: EASE_OUT } },
	open: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.menuIn, ease: EASE_OUT } }
};

/** Bubble sizes from `messages.css`, for where the window grows from: the launcher, then each head above it. */
const LAUNCHER = 48;
const HEAD = 40;
const GAP = 10;
const WINDOW_GAP = 16;

/** The point the window grows from: the middle of the bubble it rose from, `place` heads above the launcher. */
function originOf(place: number): string {
	const fromBottom = place < 0 ? LAUNCHER / 2 : LAUNCHER + GAP + place * (HEAD + GAP) + HEAD / 2;

	return `calc(100% + ${WINDOW_GAP + LAUNCHER / 2}px) calc(100% - ${fromBottom}px)`;
}

interface DockWindowProps {
	view: DockView;
	conversations: Conversation[];
	/** Which head the window rose from, counted up from the launcher; -1 for the launcher. */
	place: number;
	onNewMessage: () => void;
	/** Runs as the window folds back or shuts from inside, to give focus back to its bubble. */
	onLeave: () => void;
}

/** The window's name for a screen reader: Messages, or who the conversation is with. */
function windowLabel(view: DockView, conversations: Conversation[]): string {
	if (view.kind === 'inbox') return 'Messages';

	const conversation = conversations.find((item) => item.id === view.conversationId);

	return conversation ? `Conversation with ${displayName(conversation.with)}` : 'Conversation';
}

/**
 * The one floating window, beside the bubbles with its foot on the launcher's line: every conversation, or one of
 * them. It is not modal, so the page under it stays in use. Escape inside it folds it back into its bubble.
 */
export function DockWindow({ view, conversations, place, onNewMessage, onLeave }: DockWindowProps) {
	const variants = useMotionVariants(windowMotion);
	const minimise = useDock((state) => state.minimise);
	const close = useDock((state) => state.close);

	/** Folds the window back or shuts it, then hands focus to its bubble. */
	function leave(how: () => void): void {
		how();
		onLeave();
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.key !== 'Escape' || event.defaultPrevented) return;

		event.preventDefault();
		leave(minimise);
	}

	return (
		<motion.div
			className="dock-window"
			data-view={view.kind}
			role="dialog"
			aria-modal={false}
			aria-label={windowLabel(view, conversations)}
			variants={variants}
			initial="closed"
			animate="open"
			exit="closed"
			style={{ transformOrigin: originOf(place) }}
			onKeyDown={onKeyDown}
		>
			{view.kind === 'inbox' ? (
				<InboxPanel conversations={conversations} onNewMessage={onNewMessage} onClose={() => leave(close)} />
			) : (
				<ConversationPanel
					key={view.conversationId}
					conversationId={view.conversationId}
					onMinimise={() => leave(minimise)}
					onClose={() => leave(close)}
				/>
			)}
		</motion.div>
	);
}
