'use client';

import {
	Button,
	CopyButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
	writeClipboard
} from '@recoder/ui';
import { ArrowBendUpLeftIcon, ArrowClockwiseIcon, DotsThreeIcon, TextAaIcon } from '@phosphor-icons/react';
import type { RefObject } from 'react';

import type { AskMessageView } from '@/lib/ask/types';
import { clockTime, fullTime } from '@/lib/shell/age';

interface MessageActionsProps {
	message: AskMessageView;
	/** The reply's article, whose drawn words "Copy as plain text" reads. */
	article: RefObject<HTMLElement | null>;
	/** Quotes the reply in the composer; without it there is no composer beside the thread, so no Reply. */
	onReply?: (text: string) => void;
	/** Asks the question that led to this reply once more; null while a reply is arriving or there is none. */
	onAskAgain: (() => void) | null;
}

/** A message's hour, with the full date and time for a pointer that rests on it. */
export function MessageTime({ at, className }: { at: string | null; className?: string }) {
	if (!at) return null;

	return (
		<time dateTime={at} title={fullTime(at)} className={className}>
			{clockTime(at)}
		</time>
	);
}

/**
 * Capy's message toolbar: a small ringed pill at the reply's top right with the hour it arrived, Reply, Copy and a
 * menu of the rest. It shows while the reply is hovered or holds focus, and stays while its menu is open.
 */
export function MessageActions({ message, article, onReply, onAskAgain }: MessageActionsProps) {
	/** The reply as it reads on the page, with the Markdown's marks drawn away. */
	function copyPlain(): void {
		const words = article.current?.querySelector<HTMLElement>("[data-ui='markdown']")?.innerText ?? message.text;

		void writeClipboard(words.trim()).catch(() => undefined);
	}

	return (
		<div className="ask-actions" role="toolbar" aria-label="Reply actions">
			<MessageTime at={message.at} className="ask-actions-time" />
			{onReply ? (
				<Tooltip content="Reply">
					<Button variant="ghost" size="icon" aria-label="Reply" onClick={() => onReply(message.text)}>
						<ArrowBendUpLeftIcon aria-hidden />
					</Button>
				</Tooltip>
			) : null}
			<CopyButton value={message.text} label="Copy reply" iconOnly />
			<DropdownMenu>
				<Tooltip content="More">
					<DropdownMenuTrigger>
						<Button variant="ghost" size="icon" aria-label="More actions">
							<DotsThreeIcon aria-hidden />
						</Button>
					</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent align="end">
					<DropdownMenuItem icon={<TextAaIcon />} onSelect={copyPlain}>
						Copy as plain text
					</DropdownMenuItem>
					<DropdownMenuItem icon={<ArrowClockwiseIcon />} disabled={!onAskAgain} onSelect={() => onAskAgain?.()}>
						Ask again
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
