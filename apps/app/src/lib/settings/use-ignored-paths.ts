'use client';

import type { KeyboardEvent } from 'react';
import { useState } from 'react';

import { draftKeys } from './draft-keys';
import { IGNORED_PATHS_MAX } from './ignored-paths';
import { useAutoReview } from './auto-review-store';
import { useSaveState, type SaveState } from './use-save-state';

/** The list before the settings load: one array, so the store's selector answers the same value each time. */
const NO_PATHS: string[] = [];

/** Everything the ignored-paths list shows and does. */
export interface IgnoredPathsView {
	/** The saved globs, in saved order. */
	paths: string[];
	/** The text in the add field. */
	draft: string;
	/** Why the last add or remove was refused, or null. */
	error: string | null;
	state: SaveState;
	/** The field's change handler: sets the draft and clears any refusal. */
	edit: (text: string) => void;
	/** Adds the draft as a glob and saves; clears the draft when the save lands. */
	add: () => void;
	/** Removes one saved glob and saves. */
	remove: (path: string) => void;
	/** Enter adds; Escape clears the draft. */
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	/** True when the list is full (100) and nothing more can be added. */
	full: boolean;
}

/**
 * The repository path globs whose findings are never posted and never fail
 * the check. The add field holds a draft; Enter or the add button saves it,
 * Escape clears it. A glob that cannot join the list — blank aside, too long,
 * already there, or a full list — shows why under the field, and the server's
 * own refusal shows the same way.
 */
export function useIgnoredPaths(): IgnoredPathsView {
	const paths = useAutoReview((state) => state.payload?.settings.ignoredPaths ?? NO_PATHS);
	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);
	const { state, track, clearFailure } = useSaveState();

	async function commit(text: string): Promise<void> {
		const failure = await track(useAutoReview.getState().addIgnoredPath(text));

		setError(failure);

		if (!failure) setDraft((now) => (now === text ? '' : now));
	}

	function add(): void {
		const text = draft;

		if (!text.trim()) return;

		void commit(text);
	}

	async function remove(path: string): Promise<void> {
		setError(await track(useAutoReview.getState().removeIgnoredPath(path)));
	}

	function edit(text: string): void {
		setDraft(text);
		setError(null);
		clearFailure();
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		draftKeys(
			event,
			draft || null,
			() => add(),
			() => edit('')
		);
	}

	return {
		paths,
		draft,
		error,
		state,
		edit,
		add,
		remove: (path) => void remove(path),
		onKeyDown,
		full: paths.length >= IGNORED_PATHS_MAX
	};
}
