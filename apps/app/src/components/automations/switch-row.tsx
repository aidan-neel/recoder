import { Switch } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { SaveState } from '@/lib/settings/use-save-state';

import { SettingsRow } from '@/components/settings/settings-group';

/** What an on/off row needs from the hook that saves it. */
export interface SwitchView {
	on: boolean;
	state: SaveState;
	/** Saves the new value the moment the switch moves. */
	change: (on: boolean) => void;
	/** Holds the switch where it is. */
	disabled?: boolean;
}

interface SwitchRowProps {
	/** Before the text: the mark of what the switch is about. */
	leading?: ReactNode;
	name: ReactNode;
	/** The switch's spoken name. */
	label: string;
	/** What the setting does at its current value. */
	detail: ReactNode;
	toggle: SwitchView;
}

/** A setting that is on or off: it saves the moment it is switched, and shows where the save stands. */
export function SwitchRow({ leading, name, label, detail, toggle }: SwitchRowProps) {
	return (
		<SettingsRow leading={leading} name={name} detail={detail} state={toggle.state}>
			<Switch aria-label={label} checked={toggle.on} disabled={toggle.disabled} onCheckedChange={toggle.change} />
		</SettingsRow>
	);
}
