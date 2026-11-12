'use client';

import { useSettings } from './settings-store';
import { parseLimit, type LimitKey } from './limits';
import { useNumberField, type LimitFieldView } from './use-number-field';

/**
 * One review limit as a number field. It saves when it loses focus or on
 * Enter; Escape puts the saved value back. A value out of range, or a save
 * the server refused, shows its reason under the field and keeps the text
 * until it is edited. `field` names the limit it drives.
 */
export function useLimitField(field: LimitKey, max: number): LimitFieldView {
	const saved = useSettings((state) => state.models?.limits[field] ?? 0);

	return useNumberField({
		value: saved,
		current: () => useSettings.getState().models?.limits[field] ?? 0,
		save: (value) => useSettings.getState().saveModels({ [field]: value }),
		parse: (text) => parseLimit(text, max)
	});
}
