'use client';

import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';

import { draftKeys } from './draft-keys';
import { parseLimit, type LimitKey } from './limits';
import { useSettings } from './settings-store';
import { useSaveState, type SaveState } from './use-save-state';

/** A commit asked for: the text, and whether to send it again though the server refused it (Enter does, a blur does not). */
interface Commit {
	text: string;
	retry: boolean;
}

/** Everything a review-limit field shows and does. */
export interface LimitFieldView {
	/** The text on screen: the draft while editing, else the saved value formatted. */
	text: string;
	/** Why the last commit was refused, or null. */
	error: string | null;
	state: SaveState;
	/** The field's change handler: starts a draft and clears any refusal. */
	edit: (text: string) => void;
	/** Commits the draft on blur; a no-op while the field shows the saved value. */
	blur: () => void;
	/** Enter commits (retrying a refusal), Escape puts the saved value back. */
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * One review limit as a number field. It saves when it loses focus or on
 * Enter; Escape puts the saved value back. A value out of range, or a save
 * the server refused, shows its reason under the field and keeps the text;
 * leaving the field does not send a refused value again until it changes.
 * Editing or Escape clears the refusal. A commit made while a save runs waits
 * and goes out once that save settles.
 */
export function useLimitField(field: LimitKey, max: number): LimitFieldView {
	const saved = useSettings((state) => state.models?.limits[field] ?? 0);
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { state, track, clearFailure } = useSaveState();

	/** True while a save runs. */
	const saving = useRef(false);

	/** The latest commit asked for while a save ran. */
	const waiting = useRef<Commit | null>(null);

	/** The text the server refused last; cleared by any edit. */
	const refused = useRef<string | null>(null);

	async function commit({ text, retry }: Commit): Promise<void> {
		if (saving.current) {
			waiting.current = { text, retry };

			return;
		}

		if (!retry && text === refused.current) return;

		const parsed = parseLimit(text, max);

		if ('error' in parsed) return setError(parsed.error);

		if (parsed.value === useSettings.getState().models?.limits[field]) {
			setDraft((now) => (now === text ? null : now));

			return setError(null);
		}

		saving.current = true;

		const failure = await track(useSettings.getState().saveModels({ [field]: parsed.value }));

		saving.current = false;
		refused.current = failure ? text : null;
		setError(failure);

		if (!failure) setDraft((now) => (now === text ? null : now));

		const next = waiting.current;

		waiting.current = null;

		if (next) void commit(next);
	}

	function edit(text: string | null): void {
		refused.current = null;
		setDraft(text);
		setError(null);
		clearFailure();
	}

	function blur(): void {
		if (draft !== null) void commit({ text: draft, retry: false });
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		draftKeys(
			event,
			draft,
			(text) => void commit({ text, retry: true }),
			() => edit(null)
		);
	}

	return {
		text: draft ?? saved.toLocaleString('en-US'),
		error,
		state,
		edit,
		blur,
		onKeyDown
	};
}
