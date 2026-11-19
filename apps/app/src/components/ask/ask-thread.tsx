'use client';

import { Button, CopyButton, HoverList, ImageChips, LinkText, Markdown, RowButton } from '@recoder/ui';
import { ArrowElbowDownRightIcon } from '@phosphor-icons/react';

import type { AskMessageView, AskView } from '@/lib/ask/types';
import { clockTime, fullTime } from '@/lib/shell/age';

import { ChatTrail } from '../chat-trail/chat-trail';
import { CITATION_LINKS, CitedPassagesContext } from '../chat-trail/citation-chip';
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
function AskMessage({ message, onRetry, marked }: AskMessageProps) {
	return (
		<article className="ask-message" data-from={message.from} aria-label={`${NAMES[message.from]} said`}>
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
				<ReplyMeta message={message} />
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

/** A message's hour, with the full date and time for a pointer that rests on it. */
function MessageTime({ at, className }: { at: string | null; className?: string }) {
	if (!at) return null;

	return (
		<time dateTime={at} title={fullTime(at)} className={className}>
			{clockTime(at)}
		</time>
	);
}

/** Under a finished reply, as Capy has it: when it arrived, and a copy of its words. */
function ReplyMeta({ message }: { message: AskMessageView }) {
	return (
		<footer className="ask-meta">
			<MessageTime at={message.at} />
			<CopyButton value={message.text} label="Copy reply" iconOnly />
		</footer>
	);
}

/** A conversation with Recoder, oldest first. Nothing renders while it is empty. */
export function AskThread({ ask }: { ask: AskView }) {
	if (ask.messages.length === 0) return null;

	return (
		<div className="ask-thread" role="log" aria-label="Conversation with Recoder">
			{ask.messages.map((message, index) => (
				<AskMessage
					key={message.id}
					message={message}
					onRetry={ask.retry}
					marked={opensTurn(message, ask.messages[index - 1])}
				/>
			))}
		</div>
	);
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
