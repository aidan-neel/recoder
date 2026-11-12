'use client';

import { AUTO_REVIEW_INTERVALS, type AutoReviewInterval, type AutoReviewPayload, type Repo } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';

import { failureText } from '../api/http';
import { errorToast } from '../shell/notify';
import { plural } from '../shell/format';
import { useAction } from '../shell/use-action';
import { useNow } from '../shell/use-now';
import { AUTO_REVIEW_FAILED } from './auto-review-failed';
import { checkText, intervalFrom, intervalLabel } from './auto-review-text';
import { useAutoReview } from './auto-review-store';
import { useAutoReviewSwitch, type AutoReviewSwitchView } from './use-auto-review-switch';
import { useInstantChange, type SaveState } from './use-save-state';

/** The picks for the "Check every" select. */
const INTERVAL_OPTIONS = AUTO_REVIEW_INTERVALS.map((seconds) => ({
	value: String(seconds),
	label: intervalLabel(seconds)
}));

/** Runs one round of checks now; a failure says why in a toast as well as on the button. */
function checkNow(): Promise<void> {
	return useAutoReview
		.getState()
		.check()
		.catch((error: unknown) => {
			errorToast('Couldn’t check the repositories', failureText(error));

			throw error;
		});
}

/** The last round's state and its Check now action, or null before the first payload lands. */
export interface WatcherStatus {
	/** "Last checked 2 minutes ago · next in 30 seconds", or what stands in for either half. */
	text: string;
	/** "Watching 3 repositories", or "Turn on watching to check" while the watcher is off. */
	description: string;
	/** Check now is live only while the watcher is on. */
	enabled: boolean;
	status: ButtonStatus;
	run: () => void;
}

/** A repository the last round could not check, named for its row. */
export interface WatcherError {
	repoId: string;
	name: string;
	message: string;
}

/** The last round's row: its text, what it watches, and Check now. */
function watcherStatus(
	status: NonNullable<AutoReviewPayload['status']>,
	on: boolean,
	now: number,
	checkStatus: ButtonStatus,
	run: () => void
): WatcherStatus {
	return {
		text: checkText(status.lastCheckAt, on ? status.nextCheckAt : null, now),
		description: on ? `Watching ${plural(status.watching, 'repository', 'repositories')}` : 'Turn on watching to check',
		enabled: on,
		status: checkStatus,
		run
	};
}

/** Everything the Watcher group shows and does. */
export interface WatcherView {
	/** The on/off switch. */
	enabled: AutoReviewSwitchView;
	/** The "Check every" select: its value, options, save state and change. */
	interval: {
		value: AutoReviewInterval;
		options: { value: string; label: string }[];
		state: SaveState;
		/** Saves the picked interval; an unknown value is ignored. */
		change: (value: string) => void;
	};
	/** The last round's row with Check now; null until the payload lands. */
	status: WatcherStatus | null;
	/** The repositories the last round could not check. */
	errors: WatcherError[];
}

/**
 * Automations → Watcher: on or off, how often, and how the last
 * round went. The clock ticks every 5s so "checked 2 minutes ago" and "next
 * in 30 seconds" keep up.
 */
export function useWatcher(repos: Repo[]): WatcherView {
	const enabled = useAutoReviewSwitch('enabled');
	const savedInterval = useAutoReview((state) => state.payload?.settings.intervalSeconds ?? 120);
	const errors = useAutoReview((state) => state.payload?.status.errors ?? []);
	const status = useAutoReview((state) => state.payload?.status ?? null);
	const now = useNow(5000);
	const check = useAction({ showSuccess: true });

	const interval = useInstantChange(
		(seconds: AutoReviewInterval) => useAutoReview.getState().save({ intervalSeconds: seconds }),
		AUTO_REVIEW_FAILED
	);

	const every = interval.draft ? interval.draft.value : savedInterval;

	const nameOf = (id: string) => repos.find((repo) => repo.id === id)?.name ?? 'A repository';

	return {
		enabled,
		interval: {
			value: every,
			options: INTERVAL_OPTIONS,
			state: interval.state,
			change: (value) => {
				const next = intervalFrom(value);

				if (next) interval.change(next);
			}
		},
		status: status ? watcherStatus(status, enabled.on, now, check.status, () => check.run(checkNow)) : null,
		errors: errors.map((error) => ({ repoId: error.repoId, name: nameOf(error.repoId), message: error.message }))
	};
}
