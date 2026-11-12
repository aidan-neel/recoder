'use client';

import { SegmentedControl, Switch } from '@recoder/ui';

import type { LimitKey } from '@/lib/settings/limits';
import { SUBAGENT_OPTIONS, useHarness, type HarnessReady } from '@/lib/settings/use-harness';
import { useLimitField } from '@/lib/settings/use-limit-field';

import { NumberRow } from './number-row';
import { SettingsGroup, SettingsRow } from './settings-group';
import { SettingsSkeleton } from './settings-skeleton';

interface LimitRowProps {
	field: LimitKey;
	name: string;
	hint: string;
	max: number;
}

/** One review limit as a number row. */
function LimitRow({ field, name, hint, max }: LimitRowProps) {
	const view = useLimitField(field, max);

	return <NumberRow name={name} detail={hint} view={view} />;
}

/** How much a review may spend: the token budget and how many subagents go deeper. */
function Effort({ budget, subagents }: Pick<HarnessReady, 'budget' | 'subagents'>) {
	return (
		<SettingsGroup title="Effort">
			<SettingsRow name="Token budget" detail={budget.control.description} state={budget.state} stacked>
				<SegmentedControl
					aria-label="Token budget"
					value={budget.control.value}
					onValueChange={budget.change}
					options={budget.control.options}
				/>
			</SettingsRow>
			<SettingsRow name="Subagents" detail={subagents.text} state={subagents.state} stacked>
				<SegmentedControl
					aria-label="Subagents"
					value={String(subagents.value)}
					onValueChange={subagents.change}
					options={SUBAGENT_OPTIONS}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}

/**
 * Settings → Review limits: how much a review may spend, what it reports and
 * how much of a pull request it reads. Each control saves the moment it changes.
 */
export function LimitsSection() {
	const view = useHarness();

	if (!view.ready) return <SettingsSkeleton groups={[2, 1, 3]} />;

	return (
		<div className="settings">
			<Effort budget={view.budget} subagents={view.subagents} />
			<SettingsGroup title="Findings">
				<SettingsRow
					name="Low severity"
					detail={view.low.on ? 'Reviews report every severity' : 'Reviews leave out low-severity findings'}
					state={view.low.state}
				>
					<Switch aria-label="Report low-severity findings" checked={view.low.on} onCheckedChange={view.low.change} />
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup
				title="Size"
				note={
					view.configPath ? (
						<>
							Saved in <code>{view.configPath}</code>
						</>
					) : null
				}
			>
				{view.limits.map((limit) => (
					<LimitRow key={limit.key} field={limit.key} name={limit.name} hint={limit.hint} max={limit.max} />
				))}
			</SettingsGroup>
		</div>
	);
}
