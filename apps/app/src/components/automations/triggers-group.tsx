'use client';

import { Input } from '@recoder/ui';

import { useAutoReviewSwitch, type AutoReviewSwitch } from '@/lib/settings/use-auto-review-switch';
import { useMentionHandle } from '@/lib/settings/use-mention-handle';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { SwitchRow, type SwitchView } from './switch-row';

/** The switches of this group. The watcher's own switch sits with the watcher, and posting with Publishing. */
type Trigger = Exclude<AutoReviewSwitch, 'enabled' | 'postResults'>;

interface TriggerText {
	name: string;
	/** What happens while the switch is on, and while it is off. */
	on: string;
	off: string;
}

const TRIGGERS: Record<Trigger, TriggerText> = {
	onMention: {
		name: 'Someone mentions Recoder',
		on: 'A comment with the handle starts a review, and the rest of it is the brief',
		off: 'Comments never start a review'
	},
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
function TriggerSwitch({ field, toggle }: { field: Trigger; toggle: SwitchView }) {
	const text = TRIGGERS[field];

	return <SwitchRow name={text.name} label={text.name} detail={toggle.on ? text.on : text.off} toggle={toggle} />;
}

/** A trigger that stands alone: its own switch and save. */
function TriggerRow({ field }: { field: Trigger }) {
	const toggle = useAutoReviewSwitch(field);

	return <TriggerSwitch field={field} toggle={toggle} />;
}

/** The word that calls Recoder in a comment: it saves on blur or Enter, and Escape puts the saved handle back. */
function MentionHandleRow({ disabled }: { disabled: boolean }) {
	const handle = useMentionHandle(disabled);

	return (
		<SettingsRow
			name="Mention handle"
			detail="The word that calls Recoder in a comment"
			error={handle.error}
			state={handle.state}
		>
			<Input
				className="automations-code-field"
				aria-label="Mention handle"
				autoComplete="off"
				spellCheck={false}
				disabled={handle.disabled}
				invalid={handle.error !== null}
				value={handle.text}
				onChange={(event) => handle.edit(event.target.value)}
				onBlur={handle.blur}
				onKeyDown={handle.onKeyDown}
			/>
		</SettingsRow>
	);
}

/** The mention switch and its handle, which is held while mentions are off. */
function MentionRows() {
	const mention = useAutoReviewSwitch('onMention');

	return (
		<>
			<TriggerSwitch field="onMention" toggle={mention} />
			<MentionHandleRow disabled={!mention.on} />
		</>
	);
}

/** Automations → Triggers: what starts a review, and what it skips. */
export function TriggersGroup() {
	return (
		<SettingsGroup title="Triggers">
			<MentionRows />
			<TriggerRow field="onOpened" />
			<TriggerRow field="onPushed" />
			<TriggerRow field="skipDrafts" />
		</SettingsGroup>
	);
}
