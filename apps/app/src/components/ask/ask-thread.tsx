'use client';

import { Button, LinkText, Markdown, Spinner } from '@recoder/ui';

import type { AskMessageView, AskView } from '@/lib/ask/types';

import { Age } from '@/components/common/age';
import { Avatar } from '@/components/common/avatar';

/** Who a message is from, as the thread names them. */
const NAMES = { person: 'You', recoder: 'Recoder' } as const;

interface AskMessageProps {
	message: AskMessageView;
	onRetry: (id: string) => void;
}

/** One message: Recoder's replies as markdown, the person's as the plain text they typed. */
function AskMessage({ message, onRetry }: AskMessageProps) {
	const recoder = message.from === 'recoder';
	const waiting = message.state === 'writing' && message.text === '';

	return (
		<article className="entry" aria-label={`${NAMES[message.from]} said`}>
			<Avatar name={NAMES[message.from]} tone={message.from} />
			<div className="entry-head">
				<span className="entry-author">{NAMES[message.from]}</span>
				<Age at={message.at} className="meta" />
			</div>
			<div className="entry-body">
				{waiting ? <Spinner size={13} label="Recoder is thinking" /> : null}
				{recoder && !waiting ? <Markdown streaming={message.state === 'writing'}>{message.text}</Markdown> : null}
				{!recoder ? (
					<p className="entry-plain">
						<LinkText text={message.text} />
					</p>
				) : null}
				{message.state === 'failed' ? (
					<p className="entry-failed" role="alert">
						{message.error ?? 'The reply did not arrive.'}
						<Button variant="outline" size="sm" onClick={() => onRetry(message.id)}>
							Ask again
						</Button>
					</p>
				) : null}
			</div>
		</article>
	);
}

/** A conversation with Recoder, oldest first. Nothing renders while it is empty. */
export function AskThread({ ask }: { ask: AskView }) {
	if (ask.messages.length === 0) return null;

	return (
		<div className="thread" role="log" aria-label="Conversation with Recoder">
			{ask.messages.map((message) => (
				<AskMessage key={message.id} message={message} onRetry={ask.retry} />
			))}
		</div>
	);
}

/** Short questions to start from, shown while the thread is empty. A click sends the question. */
export function AskSuggestions({ ask }: { ask: AskView }) {
	if (ask.messages.length > 0 || ask.suggestions.length === 0) return null;

	return (
		<div className="ask-suggestions">
			{ask.suggestions.map((question) => (
				<Button key={question} variant="outline" size="sm" onClick={() => void ask.send(question)}>
					{question}
				</Button>
			))}
		</div>
	);
}
