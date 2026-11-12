'use client';

import { Button, LinkField, Tooltip } from '@recoder/ui';
import { ArrowUp, Square } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { useLinkFacts } from '@/lib/pulls/use-link-facts';

interface ComposerProps {
	placeholder: string;
	/** What the field is for, read out by a screen reader. */
	label: string;
	/** Sends the text. The field empties when it resolves; a rejection keeps the text so nothing typed is lost. */
	onSend: (text: string) => Promise<void>;
	/** True while a reply is arriving: the send button becomes Stop. */
	busy?: boolean;
	onStop?: () => void;
	/** The longest text the server takes, in characters. */
	limit?: number;
	/** Controls on the left of the tool row: a mode switch, a hint. */
	tools?: ReactNode;
	/** The text the field starts with. */
	initial?: string;
	rows?: number;
}

/**
 * A text field with its tools under it, ringed as one control. Enter sends;
 * Shift+Enter starts a new line. While a reply arrives the button stops it.
 */
export function Composer({
	placeholder,
	label,
	onSend,
	busy = false,
	onStop,
	limit,
	tools,
	initial = '',
	rows = 1
}: ComposerProps) {
	const [text, setText] = useState(initial);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const linkFacts = useLinkFacts();
	const over = limit !== undefined && text.length > limit;
	const ready = text.trim() !== '' && !over && !sending && !busy;

	/** Sends the text and empties the field once it is taken. */
	function send(): void {
		if (!ready) return;

		setSending(true);
		setError(null);

		onSend(text.trim())
			.then(
				() => setText(''),
				(failure: unknown) => setError(failure instanceof Error ? failure.message : 'That did not send.')
			)
			.finally(() => setSending(false));
	}

	/** Enter sends, unless Shift is held or the text is still being composed. */
	function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

		event.preventDefault();
		send();
	}

	return (
		<div className="composer">
			<LinkField
				autosize
				minRows={rows}
				maxRows={10}
				aria-label={label}
				placeholder={placeholder}
				value={text}
				invalid={over}
				linkFacts={linkFacts}
				onValueChange={setText}
				onKeyDown={onKeyDown}
			/>
			<div className="composer-foot">
				{tools}
				<div className="composer-end">
					{error ? (
						<span className="meta text-danger" role="alert">
							{error}
						</span>
					) : null}
					{over && limit !== undefined ? (
						<span className="meta text-danger" role="status">
							{text.length - limit} over the limit
						</span>
					) : null}
					{busy && onStop ? (
						<Tooltip content="Stop">
							<Button variant="secondary" size="icon" className="composer-send" aria-label="Stop" onClick={onStop}>
								<Square className="size-3" fill="currentColor" />
							</Button>
						</Tooltip>
					) : (
						<Button
							variant="primary"
							size="icon"
							className="composer-send"
							aria-label="Send"
							disabled={!ready}
							status={sending ? 'pending' : 'idle'}
							onClick={send}
						>
							<ArrowUp />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
