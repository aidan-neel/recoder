'use client';

import { parseLimit, type LimitFieldSpec } from './limits';
import { useSettings } from './settings-store';
import { useNumberField, type LimitFieldView } from './use-number-field';

/**
 * One review limit as a number field. Typing saves when it loses focus or on
 * Enter, Escape puts the saved value back, and stepping saves at once. A value
 * out of range, or a save the server refused, shows its reason under the field
 * and keeps the text until it is edited.
 */
export function useLimitField(spec: Pick<LimitFieldSpec, 'key' | 'max' | 'step' | 'shiftStep'>): LimitFieldView {
	const { key, max, step, shiftStep } = spec;
	const saved = useSettings((state) => state.models?.limits[key] ?? 0);

	return useNumberField({
		value: saved,
		max,
		step,
		shiftStep,
		current: () => useSettings.getState().models?.limits[key] ?? 0,
		save: (value) => useSettings.getState().saveModels({ [key]: value }),
		parse: (text) => parseLimit(text, max)
	});
}
