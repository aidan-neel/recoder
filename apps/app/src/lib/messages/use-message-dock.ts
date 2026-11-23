'use client';

import type { Conversation, DirectMessage } from '@recoder/shared';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { useInboxStore } from '../api/client';
import { useNow } from '../shell/use-now';
import { dockHeads } from './dock-heads';
import { useDock, type DockView } from './dock-store';

/** How long a new message peeks out beside its head. */
const PEEK_MS = 6000;

/** How often the heads are drawn again, so a conversation that went quiet leaves the stack. */
const QUIET_TICK = 60 * 1000;

/** A message that just came in from someone, while their window was shut. */
export interface Arrival {
	conversationId: string;
	message: DirectMessage;
}

export interface MessageDockView {
	/** False until the inbox answers; a server reached with the machine token has no inbox, and shows no dock. */
	ready: boolean;
	/** Every conversation, newest first, for the inbox. */
	conversations: Conversation[];
	heads: Conversation[];
	/** Unread messages across every conversation, for the launcher. */
	unread: number;
	view: DockView | null;
	origin: string;
	/** The newest arrival, which makes its head pulse once; its key changes with each message. */
	pulse: Arrival | null;
	/** The arrival peeking beside its head, for a few seconds while no window is open. */
	peek: Arrival | null;
}

/** Messages someone else just wrote, found by comparing the inbox before and after a change. */
function arrivalsBetween(next: Conversation[], previous: Conversation[]): Arrival[] {
	const before = new Map(previous.map((item) => [item.id, item.lastSequence]));

	return next.flatMap((conversation) => {
		const last = conversation.lastMessage;

		if (!last || last.authorId !== conversation.with.accountId) return [];
		if (last.sequence <= (before.get(conversation.id) ?? 0)) return [];

		return [{ conversationId: conversation.id, message: last }];
	});
}

/**
 * The floating messages as the dock draws them: the heads beside the launcher, the open window, and what a new
 * message does while that window is shut. It follows the inbox for as long as the dock is on screen, so unread counts
 * stay live on every page.
 */
export function useMessageDock(): MessageDockView {
	const inbox = useInboxStore();
	const conversations = useStore(inbox.state, (state) => state.conversations);
	const ready = useStore(inbox.state, (state) => state.phase === 'ready');
	const view = useDock((state) => state.view);
	const origin = useDock((state) => state.origin);
	const kept = useDock((state) => state.kept);
	const now = useNow(QUIET_TICK);
	const [pulse, setPulse] = useState<Arrival | null>(null);
	const [peek, setPeek] = useState<Arrival | null>(null);

	useEffect(() => inbox.follow(), [inbox]);

	useEffect(
		() =>
			inbox.state.subscribe((next, previous) => {
				if (previous.phase !== 'ready') return;

				const open = useDock.getState().view;

				for (const arrival of arrivalsBetween(next.conversations, previous.conversations)) {
					if (open?.kind === 'conversation' && open.conversationId === arrival.conversationId) continue;

					setPulse(arrival);
					if (!open) setPeek(arrival);
				}
			}),
		[inbox]
	);

	useEffect(() => {
		if (!peek) return;

		const timer = setTimeout(() => setPeek(null), PEEK_MS);

		return () => clearTimeout(timer);
	}, [peek]);

	const openId = view?.kind === 'conversation' ? view.conversationId : null;

	return {
		ready,
		conversations,
		heads: dockHeads(conversations, kept, openId, now),
		unread: conversations.reduce((sum, item) => sum + item.unread, 0),
		view,
		origin,
		pulse,
		peek: view ? null : peek
	};
}
