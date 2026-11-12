'use client';

import type { ModelSettingsPatch } from '@recoder/shared';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useEffect, useState } from 'react';

import { failureText } from '../api/http';
import { errorToast } from '../shell/notify';
import { useSettings } from './settings-store';

/** Where a save that runs on change stands. Success and failure show briefly, then the control goes quiet again. */
export type SaveState = 'idle' | 'pending' | 'success' | 'error';

/** How long the check stays after a save lands. */
const SUCCESS_MS = 1400;

/** How long the cross stays after a save fails. */
const ERROR_MS = 2400;

/** A save-face tracker that lives outside React, so a store can drive it as well as a hook. */
export interface SaveTracker extends StoreApi<{ state: SaveState }> {
	/**
	 * Tracks saves that run the moment a control changes. `track` takes the save
	 * and resolves to null when it landed, or to the reason it failed, which a
	 * `toast` title also raises as an error toast. Only the latest save drives the
	 * state, so a quick second change never shows the first one's outcome.
	 */
	track: (save: Promise<unknown>, toast?: string) => Promise<string | null>;
	/** Drops a failure's cross at once, for a control that has gone back to the saved value or is being edited again. */
	clearFailure: () => void;
	/** Clears the pending face timer; call when the owner goes away. */
	dispose: () => void;
}

/**
 * The save-face state machine without React: `state` is the face, `track`
 * drives it through one save, and only the latest tracked save shows its
 * outcome. `dispose` drops a pending timer.
 */
export function createSaveTracker(): SaveTracker {
	let latest = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const store = createStore<{ state: SaveState }>(() => ({ state: 'idle' }));

	function face(state: SaveState): void {
		store.setState({ state });
	}

	async function track(save: Promise<unknown>, toast?: string): Promise<string | null> {
		const id = ++latest;

		clearTimeout(timer);
		face('pending');

		const failure = await save.then(
			() => null,
			(error: unknown) => failureText(error, 'Couldn’t save.')
		);

		if (failure && toast) errorToast(toast, failure);

		if (id === latest) {
			face(failure ? 'error' : 'success');
			timer = setTimeout(() => face('idle'), failure ? ERROR_MS : SUCCESS_MS);
		}

		return failure;
	}

	function clearFailure(): void {
		if (store.getState().state === 'error') face('idle');
	}

	function dispose(): void {
		clearTimeout(timer);
	}

	return Object.assign(store, { track, clearFailure, dispose });
}

/**
 * Tracks saves that run the moment a control changes. `track` takes the save
 * and resolves to null when it landed, or to the reason it failed, which a
 * `toast` title also raises as an error toast. Only the latest save drives the
 * state, so a quick second change never shows the first one's outcome.
 * `clearFailure` drops a failure's cross at once, for a control that has gone
 * back to the saved value or is being edited again.
 */
export function useSaveState(): {
	state: SaveState;
	track: (save: Promise<unknown>, toast?: string) => Promise<string | null>;
	clearFailure: () => void;
} {
	const [tracker] = useState(createSaveTracker);

	useEffect(() => () => tracker.dispose(), [tracker]);

	const state = useStore(tracker, (current) => current.state);

	return { state, track: tracker.track, clearFailure: tracker.clearFailure };
}

/**
 * A setting that saves the moment it changes, through `save`. `draft` holds
 * the new value while its save runs, so it shows at once; it clears when the
 * save settles, and the saved settings (the new value, or the old one after a
 * failure that toasts `failure`) take over.
 */
export function useInstantChange<T>(
	save: (value: T) => Promise<unknown>,
	failure: string
): { draft: { value: T } | null; state: SaveState; change: (value: T) => void } {
	const [draft, setDraft] = useState<{ value: T } | null>(null);
	const { state, track } = useSaveState();

	function change(value: T): void {
		const next = { value };

		setDraft(next);

		void track(save(value), failure).then(() => {
			setDraft((now) => (now === next ? null : now));
		});
	}

	return { draft, state, change };
}

/** `useInstantChange` for the review models and limits: `patch` turns the value into the change to save. */
export function useInstantSave<T>(
	patch: (value: T) => ModelSettingsPatch,
	failure: string
): { draft: { value: T } | null; state: SaveState; change: (value: T) => void } {
	return useInstantChange((value: T) => useSettings.getState().saveModels(patch(value)), failure);
}
