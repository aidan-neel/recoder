'use client';

import { Button, Spinner, swapMotion, Textarea, Tooltip, useMotionVariants } from '@recoder/ui';
import { ArrowUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { KeyboardEvent, MouseEvent, PointerEvent, Ref } from 'react';

import { useDrafts } from '@/lib/ask/drafts';
import { focusComposer } from '@/lib/ask/focus-request';

interface ChatComposerProps {
	/** The conversation whose draft the field holds (from `draftKey`), so text stays with what it was written for. */
	draftKey: string;
	/** Sends the trimmed text; the field then clears. */
	onSend: (text: string) => void;
	/** Stops the reply in flight; without it, Send stays Send while a reply streams. */
	onStop?: () => void;
	/** A reply is streaming: Enter waits and Send becomes Stop. */
	replying: boolean;
	/** Stop was pressed and the reply has not ended yet. */
	stopping?: boolean;
	disabled?: boolean;
	label: string;
	placeholder: string;
	maxLength: number;
	textareaRef?: Ref<HTMLTextAreaElement>;
}

/** The longest the field grows before it scrolls. */
const MAX_ROWS = 8;

/** A press on the box's padding focuses the field, so the whole box reads as one input. */
function focusField(event: PointerEvent<HTMLDivElement>): void {
	const target = event.target as HTMLElement;

	if (event.button !== 0 || target.closest('button, textarea')) return;

	event.preventDefault();
	event.currentTarget.querySelector('textarea')?.focus();
}

/**
 * The message box: a growing field with Send beside it. Enter sends and
 * Shift+Enter adds a line. While a reply streams the person can keep typing,
 * but Send turns into Stop until the reply ends; pressing Stop puts focus
 * back in the field, since the button leaves with the reply. The draft lives
 * in the drafts store and only this box reads it, so typing leaves the
 * transcript be.
 */
export function ChatComposer({
	draftKey,
	onSend,
	onStop,
	replying,
	stopping = false,
	disabled = false,
	label,
	placeholder,
	maxLength,
	textareaRef
}: ChatComposerProps) {
	const swap = useMotionVariants(swapMotion);
	const value = useDrafts((state) => state.drafts[draftKey] ?? '');
	const setDraft = useDrafts((state) => state.setDraft);
	const canSend = !disabled && !replying && value.trim().length > 0;
	const showStop = replying && !!onStop;

	function send(): void {
		if (!canSend) return;

		setDraft(draftKey, '');
		onSend(value.trim());
	}

	function stop(event: MouseEvent<HTMLButtonElement>): void {
		focusComposer(event.currentTarget.closest('[data-ui="chat-composer"]'));
		onStop?.();
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

		event.preventDefault();
		send();
	}

	return (
		<div data-ui="chat-composer" data-disabled={disabled || undefined} onPointerDown={focusField}>
			<Textarea
				ref={textareaRef}
				autosize
				minRows={1}
				maxRows={MAX_ROWS}
				value={value}
				onChange={(event) => setDraft(draftKey, event.target.value)}
				onKeyDown={onKeyDown}
				aria-label={label}
				placeholder={placeholder}
				maxLength={maxLength}
				disabled={disabled}
			/>
			<span className="chat-composer-action">
				<AnimatePresence initial={false} mode="popLayout">
					{showStop ? (
						<motion.span key="stop" variants={swap} initial="initial" animate="animate" exit="exit">
							<Tooltip content="Stop">
								<Button
									variant="secondary"
									size="icon"
									className="rounded-full bg-hover hover:bg-selected"
									aria-label="Stop the reply"
									disabled={stopping}
									onClick={stop}
								>
									{stopping ? <Spinner size={13} /> : <span className="chat-stop-glyph" aria-hidden />}
								</Button>
							</Tooltip>
						</motion.span>
					) : (
						<motion.span key="send" variants={swap} initial="initial" animate="animate" exit="exit">
							<Tooltip content="Send" shortcut="Enter">
								<span className="inline-flex">
									<Button
										variant={canSend ? 'primary' : 'ghost'}
										size="icon"
										className="rounded-full"
										aria-label="Send"
										disabled={!canSend}
										onClick={send}
									>
										<ArrowUp strokeWidth={2} aria-hidden />
									</Button>
								</span>
							</Tooltip>
						</motion.span>
					)}
				</AnimatePresence>
			</span>
		</div>
	);
}
