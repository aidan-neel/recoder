'use client';

import { Button, HoverList, ImageChips, LinkText, Markdown, RowButton } from '@recoder/ui';
import { ArrowElbowDownRightIcon } from '@phosphor-icons/react';
import { useRef } from 'react';

import type { AskMessageView, AskView } from '@/lib/ask/types';

import { ChatTrail } from '../chat-trail/chat-trail';
import { CITATION_LINKS, CitedPassagesContext } from '../chat-trail/citation-chip';
import { MessageActions, MessageTime } from './message-actions';
import { ReviewCard } from './review-card';

/** Who a message is from, as a screen reader names them. */
const NAMES = { person: 'You', recoder: 'Recoder' } as const;

/** How long a conversation may rest before the next question is marked with its hour again. */
const TURN_GAP_MS = 5 * 60 * 1000;

/** Whether a question opens a new stretch of the conversation: the first one, or the first after a rest. */
function opensTurn(message: AskMessageView, previous: AskMessageView | undefined): boolean {
	if (message.from !== 'person' || !message.at) return false;
	if (!previous?.at) return true;

	return Date.parse(message.at) - Date.parse(previous.at) > TURN_GAP_MS;
}

interface AskMessageProps {
	message: AskMessageView;
	onRetry: (id: string) => void;
	/** Mark the hour over the question, as the first of a stretch of the conversation. */
	marked: boolean;
	onReply?: (text: string) => void;
	onAskAgain: (() => void) | null;
}

/** Whether a reply shows its trail: it has steps, or it is still working with nothing to say yet. */
function showsTrail(message: AskMessageView): boolean {
	if (message.trail && message.trail.length > 0) return true;

	return message.state === 'writing' && (message.trail !== undefined || message.text === '');
}

/**
 * Recoder's reply: what it did first, then its words as markdown, with citations drawn as chips. The markdown is
 * there from the start of a reply that is writing, so its first words fade in as they arrive.
 */
function ReplyBody({ message }: { message: AskMessageView }) {
	const writing = message.state === 'writing';
	const passages = { citations: message.citations ?? [], complete: !writing };

	return (
		<>
			{showsTrail(message) ? (
				<ChatTrail
					steps={message.trail ?? []}
					startedAt={message.at}
					working={writing}
					answering={message.text !== ''}
				/>
			) : null}
			{message.text === '' && !writing ? null : (
				<CitedPassagesContext value={passages}>
					<Markdown streaming={writing} linkOverride={CITATION_LINKS}>
						{message.text}
					</Markdown>
				</CitedPassagesContext>
			)}
			{message.review ? <ReviewCard review={message.review} /> : null}
		</>
	);
}

/**
 * One message, the way a chat reads: the person's question as the plain text
 * they typed, on a tint at the right; Recoder's reply as prose on the page.
 * A failed message says why and offers to ask again.
 */
function AskMessage({ message, onRetry, marked, onReply, onAskAgain }: AskMessageProps) {
	const article = useRef<HTMLElement | null>(null);

	return (
		<article ref={article} className="ask-message" data-from={message.from} aria-label={`${NAMES[message.from]} said`}>
			{message.from === 'person' ? (
				<>
					{marked ? <MessageTime at={message.at} className="ask-when" /> : null}
					<p className="ask-question">
						<LinkText text={message.text} />
					</p>
					{message.images ? <ImageChips images={message.images} className="ask-images" /> : null}
				</>
			) : (
				<ReplyBody message={message} />
			)}
			{message.from === 'recoder' && message.state === 'done' && message.text !== '' ? (
				<MessageActions message={message} article={article} onReply={onReply} onAskAgain={onAskAgain} />
			) : null}
			{message.state === 'failed' ? (
				<p className="ask-failed" role="alert">
					{message.error ?? 'The reply did not arrive.'}
					<Button variant="outline" size="sm" onClick={() => onRetry(message.id)}>
						Ask again
					</Button>
				</p>
			) : null}
		</article>
	);
}

/** The question a reply answered: the person's last message before it. */
function questionBefore(messages: readonly AskMessageView[], index: number): string | null {
	return messages.slice(0, index).findLast((before) => before.from === 'person')?.text ?? null;
}

/**
 * A conversation with Recoder, oldest first. Nothing renders while it is empty. With `onReply`, a reply's toolbar
 * quotes it in the composer beside the thread.
 */
export function AskThread({ ask, onReply }: { ask: AskView; onReply?: (text: string) => void }) {
	if (ask.messages.length === 0) return null;

	return (
		<div className="ask-thread" role="log" aria-label="Conversation with Recoder">
			{ask.messages.map((message, index) => (
				<AskMessage
					key={message.id}
					message={message}
					onRetry={ask.retry}
					marked={opensTurn(message, ask.messages[index - 1])}
					onReply={onReply}
					onAskAgain={askAgain(ask, index)}
				/>
			))}
		</div>
	);
}

/** Sends the question behind the reply at `index` again; null while a reply is arriving or no question led to it. */
function askAgain(ask: AskView, index: number): (() => void) | null {
	const question = questionBefore(ask.messages, index);

	if (ask.replying || question === null) return null;

	return () => void ask.send(question);
}

/** Short questions to start from, as quiet rows while the thread is empty. A click sends the question. */
export function AskSuggestions({ ask }: { ask: AskView }) {
	if (ask.messages.length > 0 || ask.suggestions.length === 0) return null;

	return (
		<HoverList className="ask-suggestions" itemSelector="[data-suggestion]" aria-label="Questions to start from">
			{ask.suggestions.map((question) => (
				<RowButton key={question} data-suggestion className="ask-suggestion" onClick={() => void ask.send(question)}>
					<ArrowElbowDownRightIcon aria-hidden />
					{question}
				</RowButton>
			))}
		</HoverList>
	);
}
