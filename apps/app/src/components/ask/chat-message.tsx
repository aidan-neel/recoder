'use client';

import { Markdown, cn } from '@recoder/ui';
import { Skeleton, SkeletonText } from '@recoder/ui/skeleton';
import { memo, type ReactNode } from 'react';

import { chatText, typedText } from '@/lib/ask/chat-text';
import { useSteadyText } from '@/lib/ask/steady-text';

import { useHoldBusy } from './chat-scroll';

/** The developer's words as Markdown, parsed again only when they change. */
const BubbleText = memo(function BubbleText({ text }: { text: string }) {
	return <Markdown variant="ui">{typedText(text)}</Markdown>;
});

/** What the developer wrote, right-aligned in a bubble. `children` sits under it (sending, not sent). */
export function UserBubble({ text, pending, children }: { text: string; pending?: boolean; children?: ReactNode }) {
	return (
		<div className="flex w-full flex-col items-end gap-1.5">
			<div data-ui="chat-bubble" data-pending={pending || undefined}>
				<BubbleText text={text} />
			</div>
			{children}
		</div>
	);
}

/** A reply's line height: the UI sans at 13.5px on 1.6, rounded. */
const REPLY_LINE = 22;

/** Three shimmering lines while a reply has not said anything yet; invisible for the first 120ms. */
export function ReplySkeleton() {
	return (
		<div role="status" aria-label="Waiting for a reply">
			<SkeletonText widths={['88%', '72%', '44%']} lineHeight={REPLY_LINE} barHeight={13} />
		</div>
	);
}

/** A question and the start of a reply in outline while the conversation loads; invisible for the first 120ms. */
export function ConversationSkeleton() {
	return (
		<div role="status" aria-label="Loading the conversation" className="flex flex-col gap-5">
			<Skeleton className="ml-auto h-[35px] w-[58%] rounded-[14px]" />
			<SkeletonText widths={['86%', '64%']} lineHeight={REPLY_LINE} barHeight={13} />
		</div>
	);
}

interface ReplyTextProps {
	text: string;
	streaming: boolean;
	/** The line under the reply (the model, or that it stopped), shown once every word is out. */
	footer?: ReactNode;
}

/**
 * A model reply in the UI sans, fed out at a steady pace while it streams,
 * with the caret after the last word until it is all shown. The transcript
 * stays busy for screen readers until then.
 */
export function ReplyText({ text, streaming, footer }: ReplyTextProps) {
	const shown = useSteadyText(text);
	const arriving = streaming || shown.length < text.length;
	const display = chatText(shown, !arriving);

	useHoldBusy(arriving);

	if (!display && streaming) return <ReplySkeleton />;

	return (
		<div className="min-w-0">
			{display ? (
				<Markdown variant="ui" streaming={arriving}>
					{display}
				</Markdown>
			) : null}
			{arriving ? null : footer}
		</div>
	);
}

/** The model name under a reply, without its provider prefix; the full id shows on hover. */
export function ModelMeta({ model }: { model: string }) {
	return <ReplyMeta title={model}>{model.slice(model.lastIndexOf('/') + 1)}</ReplyMeta>;
}

/** The faint line under a reply: who wrote it, or that it was stopped. */
export function ReplyMeta({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
	return (
		<p title={title} className={cn('mt-1.5 truncate font-mono text-[11px] leading-4 text-fg-faint', className)}>
			{children}
		</p>
	);
}
