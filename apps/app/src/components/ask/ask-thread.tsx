'use client';

import { Button, HoverList, ImageChips, LinkText, Markdown, RowButton } from '@recoder/ui';
import { CornerDownRight } from 'lucide-react';

import type { AskMessageView, AskView } from '@/lib/ask/types';

import { ChatTrail } from '../chat-trail/chat-trail';
import { CITATION_LINKS, CitedPassagesContext } from '../chat-trail/citation-chip';

/** Who a message is from, as a screen reader names them. */
const NAMES = { person: 'You', recoder: 'Recoder' } as const;

interface AskMessageProps {
	message: AskMessageView;
	onRetry: (id: string) => void;
}

/** Whether a reply shows its trail: it has steps, or it is still working with nothing to say yet. */
function showsTrail(message: AskMessageView): boolean {
	if (message.trail && message.trail.length > 0) return true;

	return message.state === 'writing' && (message.trail !== undefined || message.text === '');
}

/** Recoder's reply: what it did first, then its words as markdown, with citations drawn as chips. */
function ReplyBody({ message }: { message: AskMessageView }) {
	const writing = message.state === 'writing';
	const passages = { citations: message.citations ?? [], complete: !writing };

	return (
		<>
			{showsTrail(message) ? (
				<ChatTrail steps={message.trail ?? []} startedAt={message.at} working={writing && message.text === ''} />
			) : null}
			{message.text === '' ? null : (
				<CitedPassagesContext value={passages}>
					<Markdown streaming={writing} linkOverride={CITATION_LINKS}>
						{message.text}
					</Markdown>
				</CitedPassagesContext>
			)}
		</>
	);
}

/**
 * One message, the way a chat reads: the person's question as the plain text
 * they typed, on a tint at the right; Recoder's reply as prose on the page.
 * A failed message says why and offers to ask again.
 */
function AskMessage({ message, onRetry }: AskMessageProps) {
	return (
		<article className="ask-message" data-from={message.from} aria-label={`${NAMES[message.from]} said`}>
			{message.from === 'person' ? (
				<>
					<p className="ask-question">
						<LinkText text={message.text} />
					</p>
					{message.images ? <ImageChips images={message.images} className="ask-images" /> : null}
				</>
			) : (
				<ReplyBody message={message} />
			)}
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

/** A conversation with Recoder, oldest first. Nothing renders while it is empty. */
export function AskThread({ ask }: { ask: AskView }) {
	if (ask.messages.length === 0) return null;

	return (
		<div className="ask-thread" role="log" aria-label="Conversation with Recoder">
			{ask.messages.map((message) => (
				<AskMessage key={message.id} message={message} onRetry={ask.retry} />
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
					<CornerDownRight aria-hidden />
					{question}
				</RowButton>
			))}
		</HoverList>
	);
}
