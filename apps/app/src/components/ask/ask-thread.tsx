'use client';

import { Button } from '@recoder/ui';
import { AnimatePresence } from 'motion/react';
import { memo } from 'react';

import type { AskMessage, AskThread } from '@/lib/ask/ask-store';
import { suggestionsFor, type AskItem } from '@/lib/ask/item';

import { ChatRow } from './chat-row';
import { ModelMeta, ReplyMeta, ReplyText, UserBubble } from './chat-message';
import { ReplyFailure } from './chat-notice';

interface AskThreadViewProps {
	item: AskItem;
	thread: AskThread;
	onAsk: (question: string) => void;
	onRetry: () => void;
}

interface AskReplyProps {
	message: AskMessage;
	/** The thread's last message: a failure here carries the full notice with Try again. */
	latest: boolean;
	onRetry: () => void;
}

/** The line under a reply: the model once it finished, or that it was stopped. A failure says so in its own notice. */
function footerOf(message: AskMessage) {
	if (message.state === 'stopped') return <ReplyMeta>Stopped</ReplyMeta>;

	return message.model && message.state === 'done' ? <ModelMeta model={message.model} /> : null;
}

/**
 * A reply from the reviewer: its words with the model under them, or that it
 * stopped, then why it failed if it did. Memoised, so a reply that settled is
 * not parsed again while another streams.
 */
const AskReply = memo(function AskReply({ message, latest, onRetry }: AskReplyProps) {
	const said = message.text.trim().length > 0;

	if (!said && message.state === 'stopped') return <ReplyMeta className="mt-0">Stopped</ReplyMeta>;

	return (
		<div className="flex min-w-0 flex-col gap-2">
			{said || !message.failure ? (
				<ReplyText text={message.text} streaming={message.state === 'streaming'} footer={footerOf(message)} />
			) : null}
			{message.failure ? (
				<ReplyFailure
					reason={message.failure.message}
					action={message.failure.action}
					partial={said}
					quiet={!latest}
					onRetry={latest ? onRetry : null}
				/>
			) : null}
		</div>
	);
});

/**
 * The thread about one item: questions in bubbles, replies in the UI sans.
 * Empty, it offers a few questions to start with, near the composer.
 */
export function AskThreadView({ item, thread, onAsk, onRetry }: AskThreadViewProps) {
	const last = thread.messages.at(-1);

	return (
		<AnimatePresence initial={false} mode="popLayout">
			{last ? null : (
				<ChatRow key="suggestions" className="mt-auto flex flex-col items-end gap-2">
					{suggestionsFor(item).map((suggestion) => (
						<Button
							key={suggestion.intent}
							variant="outline"
							className="chat-suggestion"
							onClick={() => onAsk(suggestion.text)}
						>
							{suggestion.text}
						</Button>
					))}
				</ChatRow>
			)}
			{thread.messages.map((message) => (
				<ChatRow key={message.id}>
					{message.role === 'user' ? (
						<UserBubble text={message.text} />
					) : (
						<AskReply message={message} latest={message === last} onRetry={onRetry} />
					)}
				</ChatRow>
			))}
		</AnimatePresence>
	);
}
