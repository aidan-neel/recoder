'use client';

import { DEFAULT_SUBAGENT_CAP, SUBAGENT_CAPS, type SubagentCap } from '@recoder/shared';
import { CopyButton, SegmentedControl, Switch } from '@recoder/ui';

import { LIMIT_FIELDS } from '@/lib/settings/limits';
import { useSettings } from '@/lib/settings/settings-store';
import { useInstantSave } from '@/lib/settings/use-save-state';

import { LimitField } from './limit-field';
import { SaveStatus } from './save-status';
import { SettingsGroup, SettingsRow } from './settings-group';

const SUBAGENT_OPTIONS = SUBAGENT_CAPS.map((cap) => ({ value: String(cap), label: cap ? `Up to ${cap}` : 'Off' }));

/** What each cap allows; shown under the name for the current pick. */
const SUBAGENT_TEXT: Record<SubagentCap, string> = {
	0: 'Reviewers work alone, using the fewest tokens',
	2: 'Reviewers can run up to 2 subagents per review',
	4: 'Reviewers can run up to 4 subagents, using the most tokens'
};

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

/** Settings → Review harness: how many subagents a review may run, low-severity findings, the review limits, and where they are saved. */
export function HarnessSection() {
	const settings = useSettings((state) => state.models);
	const cap = useInstantSave((subagentCap: SubagentCap) => ({ subagentCap }), FAILED);
	const low = useInstantSave((reportLowSeverity: boolean) => ({ reportLowSeverity }), FAILED);

	if (!settings) return null;

	const capValue = cap.draft ? cap.draft.value : (settings.subagentCap ?? DEFAULT_SUBAGENT_CAP);
	const lowValue = low.draft ? low.draft.value : settings.reportLowSeverity;

	return (
		<>
			<SettingsGroup title="Reviewers">
				<SettingsRow name="Subagents" description={SUBAGENT_TEXT[capValue]}>
					<SaveStatus state={cap.state} />
					<SegmentedControl
						aria-label="Subagents"
						value={String(capValue)}
						onValueChange={(value) => cap.change(Number(value) as SubagentCap)}
						options={SUBAGENT_OPTIONS}
					/>
				</SettingsRow>
				<SettingsRow
					name="Low severity findings"
					description={lowValue ? 'Reviews report every severity' : 'Reviews report medium and above'}
				>
					<SaveStatus state={low.state} />
					<Switch checked={lowValue} onCheckedChange={low.change} aria-label="Low severity findings" />
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title="Review limits">
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
				<SettingsGroup title="Storage">
					<SettingsRow name="Config file" description={<PathText path={settings.configPath} />}>
						<CopyButton value={settings.configPath} label="Copy path" iconOnly />
					</SettingsRow>
				</SettingsGroup>
			) : null}
		</>
	);
}
