'use client';

import {
	DEFAULT_SUBAGENT_CAP,
	SUBAGENT_CAPS,
	TOKEN_BUDGET_PLANS,
	budgetPatch,
	subagentCapFrom,
	type SubagentCap,
	type TokenBudget
} from '@recoder/shared';
import { CopyButton, SegmentedControl, Switch } from '@recoder/ui';

import { LIMIT_FIELDS } from '@/lib/settings/limits';
import { useSettings } from '@/lib/settings/settings-store';
import { budgetModels, shownBudget } from '@/lib/settings/token-budget';
import { useInstantSave } from '@/lib/settings/use-save-state';

import { BudgetRow } from './budget-row';
import { LimitField } from './limit-field';
import { SaveStatus } from './save-status';
import { SettingsGroup, SettingsRow } from './settings-group';

const SUBAGENT_OPTIONS = SUBAGENT_CAPS.map((cap) => ({
	value: String(cap),
	label: cap === 'uncapped' ? 'Uncapped' : cap ? `Up to ${cap}` : 'Off'
}));

/** What each cap allows; shown under the name for the current pick. */
const SUBAGENT_TEXT: Record<SubagentCap, string> = {
	0: 'Reviewers work alone, using the fewest tokens',
	3: 'Up to 3 deep dives per review',
	8: 'Up to 8 deep dives per review',
	12: 'Up to 12 deep dives per review',
	uncapped: 'One per open question. Far more tokens and time'
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

/** The settings a budget sets, as a pick on screen before the server confirms it. */
function pickBudget(budget: TokenBudget) {
	const settings = useSettings.getState().models!;

	return budgetPatch(budget, budgetModels(settings));
}

/** Settings → Review harness: the token budget, how many subagents a review may run, low-severity findings, the review limits, and where they are saved. */
export function HarnessSection() {
	const settings = useSettings((state) => state.models);
	const budget = useInstantSave(pickBudget, 'Token budget wasn’t saved');
	const cap = useInstantSave((subagentCap: SubagentCap) => ({ subagentCap }), FAILED);
	const low = useInstantSave((reportLowSeverity: boolean) => ({ reportLowSeverity }), FAILED);

	if (!settings) return null;

	const picked = budget.draft?.value;

	const capValue = picked
		? TOKEN_BUDGET_PLANS[picked].subagentCap
		: cap.draft
			? cap.draft.value
			: (settings.subagentCap ?? DEFAULT_SUBAGENT_CAP);

	const shown = picked ?? shownBudget(settings, capValue);
	const lowValue = low.draft ? low.draft.value : settings.reportLowSeverity;

	return (
		<>
			<SettingsGroup title="Reviewers">
				<BudgetRow shown={shown} saved={settings.tokenBudget} state={budget.state} onChange={budget.change} />
				<SettingsRow name="Subagents" description={SUBAGENT_TEXT[capValue]}>
					<SaveStatus state={cap.state} />
					<SegmentedControl
						aria-label="Subagents"
						value={String(capValue)}
						onValueChange={(value) => cap.change(subagentCapFrom(value))}
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
