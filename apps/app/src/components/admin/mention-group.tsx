'use client';

import { Input } from '@recoder/ui';

import { useAutoReviewSection } from '@/lib/settings/use-auto-review-section';
import { useAutoReviewSwitch } from '@/lib/settings/use-auto-review-switch';
import { useMentionHandle } from '@/lib/settings/use-mention-handle';

import { SwitchRow } from '@/components/automations/switch-row';
import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

const MENTION = 'Someone mentions Recoder';

/** The group's rows while the settings load: the switch and the handle. */
const LOADING_GROUPS = [2] as const;

/** The word that calls Recoder in a comment: it saves on blur or Enter, and Escape puts the saved handle back. */
function MentionHandleRow({ disabled }: { disabled: boolean }) {
	const handle = useMentionHandle(disabled);

	return (
		<SettingsRow name="Mention handle" error={handle.error} state={handle.state}>
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
		<SettingsGroup title="Mentions">
			<SwitchRow
				name={MENTION}
				label={MENTION}
				detail={
					mention.on
						? 'A comment with the handle starts a review, and the rest of it is the brief'
						: 'Comments never start a review'
				}
				toggle={mention}
			/>
			<MentionHandleRow disabled={!mention.on} />
		</SettingsGroup>
	);
}

/** Admin → Mentions: whether a comment that names Recoder starts a review, and the handle that names it. */
export function MentionGroup() {
	const section = useAutoReviewSection();

	if (section.view === 'offline' || section.view === 'error') {
		return <SectionNotice what="Mentions" error={section.error} retry={section.retry} />;
	}

	if (section.view === 'loading') return <SettingsSkeleton groups={LOADING_GROUPS} />;

	return <MentionRows />;
}
