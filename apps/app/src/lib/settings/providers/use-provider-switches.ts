'use client';

import { useSettings } from '../settings-store';
import { useInstantSave, type SaveState } from '../use-save-state';

/** The on/off switches of the Providers list. */
export interface ProviderSwitches {
	/** True while the provider's models show in the pickers and reviews may use it. */
	isOn: (key: string) => boolean;
	state: SaveState;
	/** Saves the provider switched on or off; the switch shows the new place while the save runs. */
	turn: (key: string, on: boolean) => void;
}

/**
 * Settings → Providers: each provider's switch. Off saves its key in
 * `disabledProviders`, so its models leave every picker and reviews never use
 * it. A second switch flipped while the first saves builds on the first.
 */
export function useProviderSwitches(): ProviderSwitches {
	const saved = useSettings((state) => state.models?.disabledProviders);
	const save = useInstantSave((disabledProviders: string[]) => ({ disabledProviders }), 'Provider wasn’t switched');
	const off = save.draft?.value ?? saved ?? [];

	return {
		isOn: (key) => !off.includes(key),
		state: save.state,
		turn: (key, on) => save.change(on ? off.filter((item) => item !== key) : [...off, key])
	};
}
