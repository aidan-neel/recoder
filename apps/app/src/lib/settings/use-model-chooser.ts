'use client';

import type { ModelEntry } from '@recoder/shared';
import { useEffect, useMemo, useState } from 'react';

import { failureText } from '../api/http';
import { settingsApi } from '../api/settings';
import { queryTerms } from '../shell/search';
import { undoToast } from '../shell/notify';
import { isGroupOpen, readOpenGroups, withOpenGroup, writeOpenGroups } from './chooser-open-groups';
import { chooserGroups, withShown, type ChooserGroup } from './model-chooser';
import { useSettings } from './settings-store';
import { useInstantSave, type SaveState } from './use-save-state';

const FAILED = 'Models weren’t saved';

const NONE: string[] = [];

/** What the Models chooser shows and does: every model with its switch, found by search. */
export interface ModelChooserView {
	/** `loading` while the full list is read; `failed` when it could not be. */
	view: 'loading' | 'failed' | 'ready';
	/** Why the list did not load. */
	error: string | null;
	retry: () => void;
	query: string;
	setQuery: (query: string) => void;
	/** The providers with a model that matches the search. */
	groups: ChooserGroup[];
	/** The model ids the pickers leave out, as they stand on screen. */
	hidden: ReadonlySet<string>;
	/** Where the last save stands. */
	state: SaveState;
	/** Whether the group shows its models. */
	isOpen: (group: ChooserGroup) => boolean;
	/** Opens or shuts a group. Outside a search the choice is kept in this browser. */
	setOpen: (group: ChooserGroup, open: boolean) => void;
	/** Shows or hides one model in the pickers. */
	setShown: (id: string, shown: boolean) => void;
	/** Shows or hides every model of a provider that the search lists, with Undo. */
	setGroupShown: (group: ChooserGroup, shown: boolean) => void;
}

/** The full model list, read again whenever a provider is switched on or off. A failure keeps its reason until a retry. */
function useAllModels(): { entries: ModelEntry[] | null; error: string | null; retry: () => void } {
	const switches = useSettings((state) => state.models?.disabledProviders.join('\n'));
	const [entries, setEntries] = useState<ModelEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let current = true;

		settingsApi.chooserModels().then(
			(models) => {
				if (!current) return;

				setEntries(models);
				setError(null);
			},
			(failure: unknown) => {
				if (current) setError(failureText(failure, 'Models didn’t load.'));
			}
		);

		return () => {
			current = false;
		};
	}, [switches, attempt]);

	return { entries, error, retry: () => setAttempt((count) => count + 1) };
}

/** Whether the list is read, still loading, or failed with nothing to show. */
function viewOf(entries: ModelEntry[] | null, error: string | null): ModelChooserView['view'] {
	if (entries) return 'ready';

	return error ? 'failed' : 'loading';
}

/**
 * Settings → Models, the chooser: every model of a switched-on provider with a
 * switch, and the search that narrows them. A switch saves at once, and a
 * whole provider's Show all or Hide all offers Undo.
 */
export function useModelChooser(): ModelChooserView {
	const { entries, error, retry } = useAllModels();
	const saved = useSettings((state) => state.models?.hiddenModels);
	const [query, setQueryText] = useState('');
	const [remembered, setRemembered] = useState(readOpenGroups);
	const [chosenDuringSearch, setChosenDuringSearch] = useState<ReadonlyMap<string, boolean>>(new Map());
	const instant = useInstantSave((hiddenModels: string[]) => ({ hiddenModels }), FAILED);
	const hiddenIds = instant.draft?.value ?? saved ?? NONE;
	const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
	const terms = useMemo(() => queryTerms(query), [query]);
	const groups = useMemo(() => (entries ? chooserGroups(entries, terms) : []), [entries, terms]);

	function setQuery(text: string): void {
		setQueryText(text);
		setChosenDuringSearch(new Map());
	}

	function isOpen(group: ChooserGroup): boolean {
		return isGroupOpen(group.heading, remembered, chosenDuringSearch, terms.length > 0);
	}

	function setOpen(group: ChooserGroup, open: boolean): void {
		if (terms.length > 0) {
			setChosenDuringSearch(new Map(chosenDuringSearch).set(group.heading, open));

			return;
		}

		const next = withOpenGroup(remembered, group.heading, open);

		setRemembered(next);
		writeOpenGroups(next);
	}

	function setShown(id: string, shown: boolean): void {
		instant.change(withShown(hiddenIds, [id], shown));
	}

	function setGroupShown(group: ChooserGroup, shown: boolean): void {
		const before = hiddenIds;

		instant.change(
			withShown(
				before,
				group.options.map((option) => option.id),
				shown
			)
		);

		undoToast(`${shown ? 'Showing' : 'Hiding'} every ${group.heading} model`, () => instant.change(before));
	}

	return {
		view: viewOf(entries, error),
		error,
		retry,
		query,
		setQuery,
		groups,
		hidden,
		isOpen,
		setOpen,
		state: instant.state,
		setShown,
		setGroupShown
	};
}
