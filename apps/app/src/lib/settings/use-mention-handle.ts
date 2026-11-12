'use client';

import { DEFAULT_MENTION_HANDLE } from '@recoder/shared';
import type { KeyboardEvent } from 'react';
import { useState } from 'react';

import { handleError } from './auto-review-text';
import { draftKeys } from './draft-keys';
import { useAutoReview } from './auto-review-store';
import { useSaveState, type SaveState } from './use-save-state';

/** Everything the mention-handle field shows and does. */
export interface MentionHandleView {
	/** The text on screen: the draft while editing, else the saved handle. */
	text: string;
	/** Why the last commit was refused, or null. */
	error: string | null;
	state: SaveState;
	/** The field's change handler: starts a draft and clears any refusal. */
	edit: (text: string) => void;
	/** Commits the draft on blur; a no-op while the field shows the saved handle. */
	blur: () => void;
	/** Enter commits, Escape puts the saved handle back. */
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	/** The field is held while mentions are off. */
	disabled: boolean;
}

/**
 * The word that summons Recoder in a comment. It saves when it loses focus
 * or on Enter; Escape puts the saved handle back. A handle that can't be
 * used, or one the server refused, shows why under the field and keeps the
 * text until it is edited. `disabled` holds it while mentions are off.
 */
export function useMentionHandle(disabled: boolean): MentionHandleView {
	const saved = useAutoReview((state) => state.payload?.settings.mentionHandle ?? DEFAULT_MENTION_HANDLE);
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { state, track, clearFailure } = useSaveState();

	async function commit(text: string): Promise<void> {
		const invalid = handleError(text);

		if (invalid) return setError(invalid);

		const handle = text.trim();

		if (handle === saved) {
			setDraft(null);

			return setError(null);
		}

		const failure = await track(useAutoReview.getState().save({ mentionHandle: handle }));

		setError(failure);

		if (!failure) setDraft((now) => (now === text ? null : now));
	}

	function edit(text: string | null): void {
		setDraft(text);
		setError(null);
		clearFailure();
	}

	function blur(): void {
		if (draft !== null) void commit(draft);
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		draftKeys(
			event,
			draft,
			(text) => void commit(text),
			() => edit(null)
		);
	}

	return { text: draft ?? saved, error, state, edit, blur, onKeyDown, disabled };
}
