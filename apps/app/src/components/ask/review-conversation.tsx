'use client';

import { MAX_CHAT_MESSAGE_CHARS, type Review } from '@recoder/shared';
import { AnimatePresence } from 'motion/react';
import { useCallback, useMemo, useRef } from 'react';

import {
	conversationRows,
	inFlightReply,
	lastQuestionAt,
	orchestratorMessages,
	retryFor
} from '@/lib/ask/conversation';
import { draftKey } from '@/lib/ask/drafts';
import { NO_OUTGOING, useReviewChat } from '@/lib/ask/review-chat';
import { useStickToBottom } from '@/lib/ask/stick-to-bottom';
import { isRunning, useReview } from '@/lib/review/review-store';

import { ChatComposer } from './chat-composer';
import { ConversationSkeleton, ReplySkeleton } from './chat-message';
import { ChatRow } from './chat-row';
import { ChatScroll } from './chat-scroll';
import { ConversationMessage, OutgoingMessage } from './conversation-message';

/** What the composer invites, by where the review stands. */
function placeholderFor(review: Review): string {
	if (review.status === 'draft') return 'Ask Orchestrator to start a review…';

	return isRunning(review) ? 'Ask Orchestrator anything…' : 'Ask a follow-up about this review…';
}

/** The line an empty conversation shows. */
function emptyFor(review: Review): string {
	if (review.status === 'draft') return 'Tell Orchestrator what to look at, then start the review.';

	return isRunning(review)
		? 'Ask Orchestrator about this review while it works.'
		: 'Ask Orchestrator about this review.';
}

/**
 * The conversation with Orchestrator, in the ask column while the overview or
 * a file is selected, for the whole life of the review: draft, running and
 * finished. Messages come from the review's event stream; what the developer
 * sends shows at once, then joins the stream's copy. Until the stream's first
 * snapshot lands, outlines hold the transcript's place. The list follows
 * streaming text unless the reader scrolled up. A control that goes away when
 * pressed (Try again, Discard) moves focus to the composer first.
 */
export function ReviewConversation({ review }: { review: Review }) {
	const reviewId = review.id;
	const loaded = useReview((state) => state.progress !== null);
	const allMessages = useReview((state) => state.progress?.messages);
	const outbox = useReviewChat((state) => state.outbox[reviewId] ?? NO_OUTGOING);
	const stopping = useReviewChat((state) => state.stopping[reviewId]);
	const messages = useMemo(() => orchestratorMessages(allMessages), [allMessages]);
	const rows = useMemo(() => conversationRows(messages, outbox), [messages, outbox]);
	const asked = lastQuestionAt(rows);
	const reply = inFlightReply(messages);
	const stick = useStickToBottom(reviewId);
	const { toBottom } = stick;
	const field = useRef<HTMLTextAreaElement>(null);
	const last = rows.at(-1);
	const waiting = last?.kind === 'outgoing' && last.outgoing.state === 'sent';

	const send = useCallback(
		(text: string) => {
			toBottom(false);
			field.current?.focus({ preventScroll: true });
			useReviewChat.getState().send(reviewId, text);
		},
		[reviewId, toBottom]
	);

	function resend(key: string): void {
		field.current?.focus({ preventScroll: true });
		useReviewChat.getState().resend(reviewId, key);
	}

	function discard(key: string): void {
		field.current?.focus({ preventScroll: true });
		useReviewChat.getState().discard(reviewId, key);
	}

	function stop(): void {
		if (reply) void useReviewChat.getState().stop(reviewId, reply.id);
	}

	return (
		<div data-ui="review-conversation">
			<ChatScroll stick={stick} label="Conversation with Orchestrator">
				{loaded ? (
					<AnimatePresence key={reviewId} initial={false} mode="popLayout">
						{rows.length === 0 ? (
							<ChatRow
								key="empty"
								className="m-auto max-w-[280px] text-center text-[13px] leading-5 text-balance text-fg-subtle"
							>
								{emptyFor(review)}
							</ChatRow>
						) : null}
						{rows.map((row, position) => (
							<ChatRow key={row.key}>
								{row.kind === 'message' ? (
									<ConversationMessage
										message={row.message}
										quiet={position < asked}
										retry={reply ? null : retryFor(rows, position)}
										onSend={send}
									/>
								) : (
									<OutgoingMessage outgoing={row.outgoing} onResend={resend} onDiscard={discard} />
								)}
							</ChatRow>
						))}
						{waiting ? (
							<ChatRow key="waiting">
								<ReplySkeleton />
							</ChatRow>
						) : null}
					</AnimatePresence>
				) : (
					<ConversationSkeleton />
				)}
			</ChatScroll>
			<div className="ask-composer">
				<ChatComposer
					textareaRef={field}
					draftKey={draftKey(reviewId, 'review')}
					onSend={send}
					onStop={stop}
					replying={!!reply}
					stopping={!!reply && stopping === reply.id}
					label="Message Orchestrator"
					placeholder={placeholderFor(review)}
					maxLength={MAX_CHAT_MESSAGE_CHARS}
				/>
			</div>
		</div>
	);
}
