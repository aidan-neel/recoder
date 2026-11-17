'use client';

import { MAX_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW, type ModelSettings } from '@recoder/shared';

import { contextWindowPick, type ContextWindowPick } from './context-windows';
import { parseLimit } from './limits';
import { useSettings } from './settings-store';
import { useNumberField, type LimitFieldView } from './use-number-field';
import { useSaveState, type SaveState } from './use-save-state';

/** The smallest step a window takes, which is also the smallest window. */
const STEP = MIN_CONTEXT_WINDOW;

/** The step while Shift is held. */
const SHIFT_STEP = 128_000;

const RESET_FAILED = 'Context window wasn’t reset';

/** One picked model's context window field, and the reset back to what its provider reports. */
export interface ContextWindowView {
	pick: ContextWindowPick;
	field: LimitFieldView;
	/** Where the last save stands, the field's or the reset's. */
	state: SaveState;
	/** Drops the saved window, so reviews use the reported one again. */
	reset: () => void;
}

/** The effective window for `id` in the saved settings, or 0 before they load. */
function effectiveWindow(settings: ModelSettings | null, id: string): number {
	return settings ? contextWindowPick(settings, id).effective : 0;
}

/**
 * A picked model's context window as a number field. Typing saves on blur or
 * Enter and stepping saves at once, like the review limits; Reset removes the
 * saved window.
 */
export function useContextWindow(pick: ContextWindowPick): ContextWindowView {
	const { id } = pick;
	const resetSave = useSaveState();

	const field = useNumberField({
		value: pick.effective,
		min: MIN_CONTEXT_WINDOW,
		max: MAX_CONTEXT_WINDOW,
		step: STEP,
		shiftStep: SHIFT_STEP,
		current: () => effectiveWindow(useSettings.getState().models, id),
		save: (value) => useSettings.getState().saveModels({ contextWindows: { [id]: value } }),
		parse: (text) => parseLimit(text, MAX_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW)
	});

	function reset(): void {
		void resetSave.track(useSettings.getState().saveModels({ contextWindows: { [id]: null } }), RESET_FAILED);
	}

	return { pick, field, state: resetSave.state === 'idle' ? field.state : resetSave.state, reset };
}
