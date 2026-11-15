'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useAction } from '../shell/use-action';
import { useGuidelines, type OverviewStatus } from './guidelines-store';

/** Everything a screen that lists guidelines shows and does. */
export interface GuidelinesSection {
	/** Where the overview load stands. */
	status: OverviewStatus;
	/** The overview once it has loaded; null while loading or after a failure. */
	overview: GuidelinesOverview | null;
	/** Why the first load failed, as the server put it. */
	error: string | null;
	/** The notice's retry, for a load that failed. */
	retry: { status: ButtonStatus; run: () => void };
}

/**
 * What reviewers follow, on the page or section that lists it. `loader` is
 * the store's `load` (the Guidelines page, which reads every repository's
 * file too) or `loadOverview` (Settings → Recoder, which needs the global
 * layer alone).
 */
export function useGuidelinesSection(loader: () => Promise<void>): GuidelinesSection {
	const status = useGuidelines((state) => state.status);
	const overview = useGuidelines((state) => state.overview);
	const error = useGuidelines((state) => state.error);
	const retry = useAction();

	useEffect(() => {
		void loader();
	}, [loader]);

	return {
		status,
		overview,
		error,
		retry: { status: retry.status, run: () => retry.run(loader) }
	};
}
