'use client';

import { DEFAULT_SUBAGENT_CAP, type ModelSettings, type SubagentCap } from '@recoder/shared';
import { CopyButton, SegmentedControl, Switch } from '@recoder/ui';
import { useEffect } from 'react';

import { LIMIT_FIELDS } from '@/lib/settings/limits';
import { retrySettings, useSettings } from '@/lib/settings/settings-store';
import { useInstantSave } from '@/lib/settings/use-save-state';

import { SectionNotice } from './group-notice';
import { LimitField } from './limit-field';
import { LOW_SEVERITY, SUBAGENTS } from './row-copy';
import { SaveStatus } from './save-status';
import { SettingsGroup, SettingsRow } from './settings-group';
import { SettingsSectionSkeleton } from './settings-skeleton';

const FAILED = 'Settings weren’t saved';

/** A file path with a break chance after each separator, so a long one wraps between folders, not inside a name. */
function PathText({ path }: { path: string }) {
	const parts = path.split(/(?<=[/\\])/);

	return (
		<span className="settings-path" title={path}>
			{parts.flatMap((part, index) => (index ? [<wbr key={index} />, part] : [part]))}
		</span>
	);
}

/** The loaded settings: subagents and low-severity findings, the limits, and the config file. */
function HarnessGroups({ settings }: { settings: ModelSettings }) {
	const cap = useInstantSave((subagentCap: SubagentCap) => ({ subagentCap }), FAILED);
	const low = useInstantSave((reportLowSeverity: boolean) => ({ reportLowSeverity }), FAILED);
	const capValue = cap.draft ? cap.draft.value : (settings.subagentCap ?? DEFAULT_SUBAGENT_CAP);
	const lowValue = low.draft ? low.draft.value : settings.reportLowSeverity;

	return (
		<div className="settings-stack">
			<SettingsGroup title="Reviewers" group="reviewers">
				<SettingsRow name={SUBAGENTS.name} description={SUBAGENTS.text[capValue]}>
					<SaveStatus state={cap.state} />
					<SegmentedControl
						aria-label={SUBAGENTS.name}
						value={String(capValue)}
						onValueChange={(value) => cap.change(Number(value) as SubagentCap)}
						options={SUBAGENTS.options}
					/>
				</SettingsRow>
				<SettingsRow name={LOW_SEVERITY.name} description={lowValue ? LOW_SEVERITY.on : LOW_SEVERITY.off}>
					<SaveStatus state={low.state} />
					<Switch checked={lowValue} onCheckedChange={low.change} aria-label={LOW_SEVERITY.name} />
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title="Review limits" group="limits">
				{LIMIT_FIELDS.map((field) => (
					<LimitField
						key={field.key}
						field={field.key}
						name={field.name}
						hint={field.hint}
						max={field.max}
						value={settings.limits[field.key]}
					/>
				))}
			</SettingsGroup>
			{settings.configPath ? (
				<SettingsGroup title="Storage" group="storage">
					<SettingsRow name="Config file" description={<PathText path={settings.configPath} />}>
						<CopyButton value={settings.configPath} label="Copy path" iconOnly />
					</SettingsRow>
				</SettingsGroup>
			) : null}
		</div>
	);
}

/**
 * Settings → Review harness: how many subagents a review may run,
 * low-severity findings, the review limits, and where they are saved. It
 * needs only the review settings, which load once a session without the
 * model catalog.
 */
export function HarnessSection() {
	const status = useSettings((state) => state.status);
	const settings = useSettings((state) => state.settings);
	const error = useSettings((state) => state.error);

	useEffect(() => {
		void useSettings.getState().loadSettings();
	}, []);

	if (status === 'offline') return <SectionNotice what="Settings didn’t load." reason={error} retry={retrySettings} />;
	if (!settings) return <SettingsSectionSkeleton section="harness" />;

	return <HarnessGroups settings={settings} />;
}
