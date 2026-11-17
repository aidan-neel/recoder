'use client';

import { useAutoReviewSwitch, type AutoReviewSwitch } from '@/lib/settings/use-auto-review-switch';

import { SettingsGroup } from '@/components/settings/settings-group';

import { SwitchRow } from './switch-row';

/**
 * The switches of this group. The watcher's own switch sits with the watcher, posting with Publishing, the
 * repository scope with Repositories, and mentions with the admin's settings.
 */
type Trigger = Exclude<AutoReviewSwitch, 'enabled' | 'postResults' | 'ownReposOnly' | 'onMention'>;

interface TriggerText {
	name: string;
	/** What happens while the switch is on, and while it is off. */
	on: string;
	off: string;
}

const TRIGGERS: Record<Trigger, TriggerText> = {
	onOpened: {
		name: 'A pull request opens',
		on: 'Every new pull request gets a review',
		off: 'New pull requests wait for you'
	},
	onPushed: {
		name: 'A reviewed pull request gets new commits',
		on: 'Pull requests Recoder reviewed on its own are reviewed again',
		off: 'A review stays on the commit it read'
	},
	skipDrafts: {
		name: 'Skip drafts',
		on: 'Drafts wait until they are ready, unless someone mentions Recoder',
		off: 'Drafts are reviewed like the rest'
	}
};

/** One trigger's switch, named and described for its current value. */
function TriggerRow({ field }: { field: Trigger }) {
	const toggle = useAutoReviewSwitch(field);
	const text = TRIGGERS[field];

	return <SwitchRow name={text.name} label={text.name} detail={toggle.on ? text.on : text.off} toggle={toggle} />;
}

/** Automations → Triggers: what starts a review, and what it skips. */
export function TriggersGroup() {
	return (
		<SettingsGroup title="Triggers">
			<TriggerRow field="onOpened" />
			<TriggerRow field="onPushed" />
			<TriggerRow field="skipDrafts" />
		</SettingsGroup>
	);
}
