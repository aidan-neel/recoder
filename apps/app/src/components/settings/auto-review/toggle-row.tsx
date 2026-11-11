'use client';

import type { AutoReviewSettings } from '@recoder/shared';
import { Switch } from '@recoder/ui';
import type { ReactNode } from 'react';

import { useAutoReview } from '@/lib/settings/auto-review-store';
import { useInstantChange } from '@/lib/settings/use-save-state';

import { SaveStatus } from '../save-status';
import { SettingsRow } from '../settings-group';

/** The auto-review settings that are on or off. */
export type AutoReviewSwitch = {
	[K in keyof AutoReviewSettings]: AutoReviewSettings[K] extends boolean ? K : never;
}[keyof AutoReviewSettings];

/** The toast title when a change does not save. */
export const AUTO_REVIEW_FAILED = 'Auto-review settings weren’t saved';

/** One switch, shown at its new value while it saves. */
export function useAutoReviewSwitch(field: AutoReviewSwitch) {
	const saved = useAutoReview((state) => state.payload?.settings[field] ?? false);

	const toggle = useInstantChange(
		(value: boolean) => useAutoReview.getState().save({ [field]: value }),
		AUTO_REVIEW_FAILED
	);

	return { on: toggle.draft ? toggle.draft.value : saved, state: toggle.state, change: toggle.change };
}

interface ToggleRowProps {
	field: AutoReviewSwitch;
	name: string;
	/** What the row does, for its current value. */
	describe: (on: boolean) => ReactNode;
}

/** An auto-review setting that saves the moment it is switched. */
export function ToggleRow({ field, name, describe }: ToggleRowProps) {
	const toggle = useAutoReviewSwitch(field);

	return (
		<SettingsRow name={name} description={describe(toggle.on)}>
			<SaveStatus state={toggle.state} />
			<Switch checked={toggle.on} onCheckedChange={toggle.change} aria-label={name} />
		</SettingsRow>
	);
}
