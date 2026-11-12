'use client';

import type { ModelSettingsPatch } from '@recoder/shared';
import { toast } from '@recoder/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { failureText } from '../api/http';
import { retryToast } from '../shell/notify';
import { useSettings } from './settings-store';

/** Where a save that runs on change stands. Success and failure show briefly, then the control goes quiet again. */
export type SaveState = 'idle' | 'pending' | 'success' | 'error';

/** How long the check stays after a save lands. */
const SUCCESS_MS = 1400;

/** How long the cross stays after a save fails. */
const ERROR_MS = 2400;

/**
 * Tracks saves that run the moment a control changes. `track` takes the save
 * and resolves to null when it landed, or to the reason it failed: the server
 * refused it, or never answered in time. Only the latest save drives the
 * state, so a quick second change never shows the first one's outcome.
 * `clearFailure` drops a failure's cross at once, for a control that has gone
 * back to the saved value or is being edited again.
 */
export function useSaveState(): {
	state: SaveState;
	track: (save: Promise<unknown>) => Promise<string | null>;
	clearFailure: () => void;
} {
	const [state, setState] = useState<SaveState>('idle');
	const latest = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	const track = useCallback(async (save: Promise<unknown>) => {
		const id = ++latest.current;

		clearTimeout(timer.current);
		setState('pending');

		const failure = await save.then(
			() => null,
			(error: unknown) => failureText(error, 'Couldn’t save.')
		);

		if (id === latest.current) {
			setState(failure ? 'error' : 'success');
			timer.current = setTimeout(() => setState('idle'), failure ? ERROR_MS : SUCCESS_MS);
		}

		return failure;
	}, []);

	const clearFailure = useCallback(() => setState((now) => (now === 'error' ? 'idle' : now)), []);

	return { state, track, clearFailure };
}

/**
 * A setting that saves the moment it changes. `draft` holds the new value
 * while its save runs, so it shows at once; it clears when the save settles,
 * and the saved settings take over: the new value, or the old one after a
 * failure, which raises a `failure` toast whose Try again sends the change
 * again. Only the latest change can raise that toast or send its value
 * again, and a newer change takes an earlier toast away, so Try again never
 * puts back a value the person has since replaced.
 */
export function useInstantSave<T>(
	patch: (value: T) => ModelSettingsPatch,
	failure: string
): { draft: { value: T } | null; state: SaveState; change: (value: T) => void } {
	const [draft, setDraft] = useState<{ value: T } | null>(null);
	const { state, track } = useSaveState();
	const latest = useRef(0);

	/** The failure toast on screen, if any. */
	const failed = useRef<string | number | null>(null);

	function change(value: T): void {
		const id = ++latest.current;
		const next = { value };

		if (failed.current !== null) toast.dismiss(failed.current);

		failed.current = null;
		setDraft(next);

		void track(useSettings.getState().saveModels(patch(value))).then((reason) => {
			setDraft((now) => (now === next ? null : now));

			if (!reason || id !== latest.current) return;

			failed.current = retryToast(failure, reason, () => {
				if (id === latest.current) change(value);
			});
		});
	}

	return { draft, state, change };
}
