'use client';

import type { FailureAction, ModelFailure, ReviewChatMessage } from '@recoder/shared';
import { Button } from '@recoder/ui';
import { CircleAlert } from 'lucide-react';
import { memo } from 'react';

import type { Outgoing } from '@/lib/ask/conversation';

import { FailureLink, ReplyFailure } from './chat-notice';
import { ModelMeta, ReplyMeta, ReplyText, UserBubble } from './chat-message';

/** The server appends this to a reply the developer stopped. */
const STOPPED = 'Reply stopped.';

interface ConversationMessageProps {
	message: ReviewChatMessage;
	/** The developer asked again since this reply failed, so its failure is one quiet line. */
	quiet: boolean;
	/** The question to ask again after this reply failed; null while another reply streams. */
	retry: string | null;
	onSend: (text: string) => void;
}

interface OutgoingMessageProps {
	outgoing: Outgoing;
	onResend: (key: string) => void;
	onDiscard: (key: string) => void;
}

/** Who a mirrored reviewer message was between. */
function forwardLabel(message: ReviewChatMessage): string | null {
	if (!message.forwardedFrom) return null;

	return `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}`;
}

/** The heading and way out for a failure whose cause has a name: signed out of ChatGPT, or out of usage. */
function namedCause(failure: ModelFailure): { title?: string; action?: FailureAction } {
	if (failure.signIn) return { title: 'Signed out of ChatGPT', action: 'sign-in' };
	if (failure.usageLimit) return { title: `${failure.usageLimit.name} is out of usage`, action: 'settings' };

	return {};
}

/** True for a reply the developer stopped; the server marks it in the text. */
function stopped(message: ReviewChatMessage): boolean {
	return message.status === 'error' && message.text.trimEnd().endsWith(STOPPED);
}

/** True for a reply that ended early with nothing else to explain it. */
function cutOff(message: ReviewChatMessage): boolean {
	return (
		message.from === 'assistant' &&
		message.status === 'error' &&
		!message.failure &&
		!message.cutOff &&
		!stopped(message)
	);
}

/** The line under a reply: that it was stopped, or the model that wrote it. */
function footerOf(message: ReviewChatMessage) {
	if (stopped(message)) return <ReplyMeta>Stopped</ReplyMeta>;

	return message.model && message.status === 'done' ? <ModelMeta model={message.model} /> : null;
}

/**
 * One message in the conversation with Orchestrator: the developer's in a
 * bubble, Orchestrator's in the UI sans with the caret while it streams.
 * Memoised, so settled messages are not parsed again on every stream event.
 */
export const ConversationMessage = memo(function ConversationMessage({
	message,
	quiet,
	retry,
	onSend
}: ConversationMessageProps) {
	const label = forwardLabel(message);

	if (message.from === 'system') {
		return <p className="text-center text-[12px] leading-[18px] text-fg-faint">{message.text}</p>;
	}

	if (message.from === 'user') {
		return (
			<div className="flex flex-col items-end gap-1">
				{label ? <p className="text-[12px] leading-4 text-fg-faint">{label}</p> : null}
				<UserBubble text={message.text} />
			</div>
		);
	}

	const text = stopped(message) ? message.text.trimEnd().slice(0, -STOPPED.length) : message.text;
	const said = text.trim().length > 0;

	return (
		<div className="flex min-w-0 flex-col gap-2">
			{label ? <p className="text-[12px] leading-4 text-fg-faint">{label}</p> : null}
			{said || !message.failure ? (
				<ReplyText text={text} streaming={message.status === 'streaming'} footer={footerOf(message)} />
			) : null}
			{message.failure ? (
				<ReplyFailure
					{...namedCause(message.failure)}
					reason={message.failure.reason}
					partial={said}
					quiet={quiet}
					onRetry={retry === null ? null : () => onSend(retry)}
				/>
			) : null}
			{cutOff(message) ? (
				<p className="flex items-start gap-1.5 text-[12.5px] leading-[18px] text-fg-subtle">
					<CircleAlert size={13} className="mt-[3px] shrink-0 text-fg-faint" aria-hidden />
					<span>
						<span className="text-fg-secondary">Reply cut off.</span> The model stopped before it finished this reply.
					</span>
				</p>
			) : null}
		</div>
	);
});

/** A message this page sent: faint while it is on its way, with Try again if the server refused it. */
export function OutgoingMessage({ outgoing, onResend, onDiscard }: OutgoingMessageProps) {
	return (
		<UserBubble text={outgoing.text} pending={outgoing.state === 'pending'}>
			{outgoing.state === 'pending' ? <span className="chat-sending">Sending</span> : null}
			{outgoing.state === 'failed' ? (
				<div role="alert" className="flex max-w-full flex-col items-end gap-1">
					<p className="flex items-start gap-1.5 text-right text-[12.5px] leading-[18px] text-danger">
						<CircleAlert size={13} className="mt-[3px] shrink-0" aria-hidden />
						<span>Not sent. {outgoing.failure?.message}</span>
					</p>
					<div className="flex gap-1">
						<Button variant="ghost" onClick={() => onDiscard(outgoing.key)}>
							Discard
						</Button>
						<FailureLink action={outgoing.failure?.action} />
						<Button variant="outline" onClick={() => onResend(outgoing.key)}>
							Try again
						</Button>
					</div>
				</div>
			) : null}
		</UserBubble>
	);
}
