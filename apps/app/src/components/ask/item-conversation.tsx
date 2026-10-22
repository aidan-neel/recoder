'use client';

import { MAX_QUESTION_CHARS } from '@recoder/shared';
import { useCallback, useRef } from 'react';

import { EMPTY_THREAD, isReplying, useAsk, type AskThread } from '@/lib/ask/ask-store';
import { draftKey } from '@/lib/ask/drafts';
import type { AskItem } from '@/lib/ask/item';
import { useStickToBottom } from '@/lib/ask/stick-to-bottom';
import { stateOf } from '@/lib/review/decisions';
import { useReview } from '@/lib/review/review-store';

import { AskContext } from './ask-context';
import { AskThreadView } from './ask-thread';
import { ChatComposer } from './chat-composer';
import { ChatScroll } from './chat-scroll';

/** What the composer invites: a first question, a follow-up, or picking something to ask about. */
function placeholderFor(item: AskItem | null, thread: AskThread): string {
	if (!item) return 'Select a decision first';

	return thread.messages.length > 0 ? 'Ask a follow-up…' : 'Ask about this…';
}

/**
 * Asking the reviewer about one decision or receipt. Each item keeps its own
 * thread and draft for the tab's session, and replies stream in word by word.
 * With no item (the sample has no Orchestrator to ask), it asks for one.
 */
export function ItemConversation({ reviewId, item }: { reviewId: string; item: AskItem | null }) {
	const sample = useReview((state) => state.sample);
	const records = useReview((state) => state.records);
	const stored = useAsk((state) => (item ? state.threads[reviewId]?.[item.key] : undefined));
	const thread = stored ?? EMPTY_THREAD;
	const replying = isReplying(thread);
	const field = useRef<HTMLTextAreaElement>(null);
	const stick = useStickToBottom(item?.key ?? 'none');

	function ask(question: string): void {
		if (!item) return;

		stick.toBottom(false);
		field.current?.focus({ preventScroll: true });
		void useAsk.getState().ask(reviewId, item, question, sample);
	}

	/** Asks again from the failure notice. Its Try again goes with it, so focus moves to the field. */
	const retry = useCallback(() => {
		if (!item) return;

		field.current?.focus({ preventScroll: true });
		void useAsk.getState().retry(reviewId, item, sample);
	}, [reviewId, item, sample]);

	function stop(): void {
		if (item) useAsk.getState().stop(reviewId, item.key);
	}

	return (
		<>
			{item ? (
				<AskContext item={item} state={item.kind === 'decision' ? stateOf(records, item.decision.id) : 'open'} />
			) : null}
			<ChatScroll stick={stick} label="Conversation with the reviewer">
				{item ? (
					<AskThreadView key={item.key} item={item} thread={thread} onAsk={ask} onRetry={retry} />
				) : (
					<p className="m-auto max-w-[240px] text-center text-[13px] leading-5 text-balance text-fg-subtle">
						Select a decision to ask about it.
					</p>
				)}
			</ChatScroll>
			<div className="ask-composer">
				<ChatComposer
					textareaRef={field}
					draftKey={draftKey(reviewId, item?.key ?? 'none')}
					onSend={ask}
					onStop={stop}
					replying={replying}
					disabled={!item}
					label="Ask the reviewer"
					placeholder={placeholderFor(item, thread)}
					maxLength={MAX_QUESTION_CHARS}
				/>
			</div>
		</>
	);
}
