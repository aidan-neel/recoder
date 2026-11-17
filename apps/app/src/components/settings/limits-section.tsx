'use client';

import { SUBAGENT_OPTIONS } from '@recoder/shared';
import { NumberField, SegmentedControl, Switch } from '@recoder/ui';

import type { LimitFieldSpec } from '@/lib/settings/limits';
import { useHarness, type HarnessReady } from '@/lib/settings/use-harness';
import { useLimitField } from '@/lib/settings/use-limit-field';

import { NumberRow } from './number-row';
import { SettingsGroup, SettingsRow } from './settings-group';
import { SettingsSkeleton } from './settings-skeleton';

/** One review limit as a stepper row. */
function LimitRow({ limit }: { limit: LimitFieldSpec }) {
	const view = useLimitField(limit);

	return <NumberRow name={limit.name} detail={limit.hint} view={view} wide />;
}

/** How much a review may spend: the token budget and how many subagents go deeper. */
function Effort({ budget, subagents }: Pick<HarnessReady, 'budget' | 'subagents'>) {
	const custom = subagents.custom;

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
			<SettingsRow name="Subagents" detail={subagents.text} error={custom?.error} state={subagents.state} stacked>
				<div className="settings-subagents">
					<SegmentedControl
						aria-label="Subagents"
						value={subagents.value}
						onValueChange={subagents.change}
						options={SUBAGENT_OPTIONS}
					/>
					{custom ? (
						<NumberField
							aria-label="Subagent count"
							aria-valuemin={custom.min}
							aria-valuemax={custom.max}
							aria-valuenow={custom.valueNow ?? undefined}
							canDecrement={custom.canDecrement}
							canIncrement={custom.canIncrement}
							invalid={custom.error !== null}
							value={custom.text}
							onStep={custom.step}
							onChange={(event) => custom.edit(event.target.value)}
							onBlur={custom.blur}
							onKeyDown={custom.onKeyDown}
						/>
					) : null}
				</div>
			</SettingsRow>
		</SettingsGroup>
	);
}

/**
 * Settings → Limits: how much a review may spend, what it reports and
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
					<LimitRow key={limit.key} limit={limit} />
				))}
			</SettingsGroup>
		</div>
	);
}
