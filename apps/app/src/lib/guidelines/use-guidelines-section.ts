'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useAction } from '../shell/use-action';
import { useGuidelinesEditor } from './editor-store';
import { useGuidelines, type OverviewStatus } from './guidelines-store';

/** Everything the Guidelines section shows and does. */
export interface GuidelinesSection {
	/** Where the overview load stands. */
	status: OverviewStatus;
	/** The overview once it has loaded; null while loading or after a failure. */
	overview: GuidelinesOverview | null;
	/** Why the first load failed, as the server put it. */
	error: string | null;
	/** The notice's retry, for a load that failed. */
	retry: { status: ButtonStatus; run: () => void };
	/** The "Discard your changes?" confirm is up. */
	asking: boolean;
	/** Keep editing: settles the confirm without running the action that was waiting. */
	keepEditing: () => void;
	/** Discard: settles the confirm and runs the waiting action. */
	discard: () => void;
}

/**
 * Settings → Guidelines: what reviewers follow. Loads the overview and every
 * tracked repository's file on mount; `asking`/`keepEditing`/`discard` drive
 * the confirm that guards an editor's unsaved text.
 */
export function useGuidelinesSection(): GuidelinesSection {
	const status = useGuidelines((state) => state.status);
	const overview = useGuidelines((state) => state.overview);
	const error = useGuidelines((state) => state.error);
	const asking = useGuidelinesEditor((state) => state.confirm !== null);
	const retry = useAction();

	useEffect(() => {
		void useGuidelines.getState().load();
	}, []);

	return {
		status,
		overview,
		error,
		retry: { status: retry.status, run: () => retry.run(() => useGuidelines.getState().load()) },
		asking,
		keepEditing: () => useGuidelinesEditor.getState().settleConfirm(false),
		discard: () => useGuidelinesEditor.getState().settleConfirm(true)
	};
}
