'use client';

import type { ComposerNote } from '@recoder/ui';
import { useState } from 'react';

interface DraftInput {
	/** Sends the text. The draft empties when it resolves; a rejection keeps the text so nothing typed is lost. */
	onSend: (text: string) => Promise<void>;
	/** The longest text the server takes, in characters. */
	limit?: number;
	/** A reply is arriving, so nothing new can be sent yet. */
	busy?: boolean;
}

/** A message being written to Recoder or to the forge: its text, whether it can go, and why not. */
export interface DraftView {
	text: string;
	setText: (text: string) => void;
	/** Adds words after what is written, on the same line. */
	append: (words: string) => void;
	/** The text is longer than the server takes. */
	over: boolean;
	/** How far over the limit the text is, or why the last send failed. */
	note: ComposerNote | null;
	/** The text can be sent now. */
	ready: boolean;
	sending: boolean;
	/** Sends the text when it is ready; does nothing otherwise. */
	send: () => void;
}

/**
 * The text of one composer and its sending. Text over the limit says by how
 * much; a refused send says why until the text changes, and keeps the text.
 */
export function useDraft({ onSend, limit, busy = false }: DraftInput): DraftView {
	const [text, setTextState] = useState('');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const overBy = limit === undefined ? 0 : text.length - limit;
	const over = overBy > 0;
	const ready = text.trim() !== '' && !over && !sending && !busy;

	function setText(next: string): void {
		setError(null);
		setTextState(next);
	}

	function append(words: string): void {
		const kept = text.trimEnd();

		setText(kept ? `${kept} ${words}` : words);
	}

	function send(): void {
		if (!ready) return;

		setSending(true);
		setError(null);

		onSend(text.trim())
			.then(
				() => setTextState(''),
				(failure: unknown) => setError(failure instanceof Error ? failure.message : 'That did not send.')
			)
			.finally(() => setSending(false));
	}

	return { text, setText, append, over, note: draftNote(overBy, error), ready, sending, send };
}

/** The bar's line: over the limit first, then a refusal. */
function draftNote(overBy: number, error: string | null): ComposerNote | null {
	if (overBy > 0) return { text: `${overBy.toLocaleString('en-US')} over the limit`, tone: 'danger' };
	if (error) return { text: error, tone: 'danger' };

	return null;
}
