'use client';

import {
	DEFAULT_SUBAGENT_CAP,
	SUBAGENT_CAPS,
	TOKEN_BUDGET_PLANS,
	budgetPatch,
	subagentCapFrom,
	tokenBudgetFrom,
	type SubagentCap,
	type TokenBudget
} from '@recoder/shared';

import { LIMIT_FIELDS } from './limits';
import { useSettings } from './settings-store';
import { budgetControl, budgetModels, shownBudget, type BudgetControl } from './token-budget';
import { useInstantSave, type SaveState } from './use-save-state';

const FAILED = 'Settings weren’t saved';

/** What each cap allows; shown under the name for the current pick. */
const SUBAGENT_TEXT: Record<SubagentCap, string> = {
	0: 'Reviewers work alone, using the fewest tokens',
	3: 'Up to 3 deep dives per review',
	8: 'Up to 8 deep dives per review',
	12: 'Up to 12 deep dives per review',
	uncapped: 'One per open question. Far more tokens and time'
};

/** The segmented control's label for a cap: Uncapped, Off at 0, else "Up to N". */
function capLabel(cap: SubagentCap): string {
	if (cap === 'uncapped') return 'Uncapped';
	if (cap === 0) return 'Off';

	return `Up to ${cap}`;
}

/** The subagent cap picks for the segmented control. */
export const SUBAGENT_OPTIONS = SUBAGENT_CAPS.map((cap) => ({
	value: String(cap),
	label: capLabel(cap)
}));

/** The token-budget row: what it shows and its control's view. */
interface HarnessBudget {
	/** The budget on screen, or Custom once the subagent cap or an effort was changed by hand. */
	shown: TokenBudget | 'custom';
	/** The saved budget, whose review limits still apply under Custom. */
	saved: TokenBudget;
	control: BudgetControl;
	state: SaveState;
	/** Saves a budget picked from `control.options` (its string value); an unknown value is ignored. */
	change: (value: string) => void;
}

/** The Review limits section once the settings have loaded. */
export interface HarnessReady {
	ready: true;
	budget: HarnessBudget;
	/** The subagent cap on screen (a budget draft can set it), its explanation and its save state. */
	subagents: {
		value: SubagentCap;
		text: string;
		state: SaveState;
		/** Saves a cap picked from `SUBAGENT_OPTIONS` (its string value). */
		change: (value: string) => void;
	};
	/** The low-severity switch: on means reviews report every severity. */
	low: { on: boolean; state: SaveState; change: (on: boolean) => void };
	/** The review limit fields. */
	limits: typeof LIMIT_FIELDS;
	/** Where the settings are saved, when the server reports a path. */
	configPath: string | null;
}

/** Settings → Review limits before its settings load: the section shows nothing yet. */
interface HarnessPending {
	ready: false;
}

/** Everything the Review limits section shows and does. */
export type HarnessView = HarnessPending | HarnessReady;

/**
 * Settings → Review limits: the token budget, how many subagents a review
 * may run, low-severity findings, the review limits, and where they are
 * saved. Each control saves the moment it changes.
 */
export function useHarness(): HarnessView {
	const settings = useSettings((state) => state.models);

	const budget = useInstantSave((next: TokenBudget) => {
		const models = useSettings.getState().models;

		return models ? budgetPatch(next, budgetModels(models)) : {};
	}, 'Token budget wasn’t saved');

	const cap = useInstantSave((subagentCap: SubagentCap) => ({ subagentCap }), FAILED);
	const low = useInstantSave((reportLowSeverity: boolean) => ({ reportLowSeverity }), FAILED);

	if (!settings) return { ready: false };

	const picked = budget.draft?.value;
	const capDraft = cap.draft?.value;

	let capValue = settings.subagentCap ?? DEFAULT_SUBAGENT_CAP;

	if (capDraft !== undefined) capValue = capDraft;
	if (picked) capValue = TOKEN_BUDGET_PLANS[picked].subagentCap;

	const shown = picked ?? shownBudget(settings, capValue);

	return {
		ready: true,
		budget: {
			shown,
			saved: settings.tokenBudget,
			control: budgetControl(shown, settings.tokenBudget),
			state: budget.state,
			change: (value) => {
				const next = tokenBudgetFrom(value);

				if (next) budget.change(next);
			}
		},
		subagents: {
			value: capValue,
			text: SUBAGENT_TEXT[capValue],
			state: cap.state,
			change: (value) => cap.change(subagentCapFrom(value))
		},
		low: { on: low.draft ? low.draft.value : settings.reportLowSeverity, state: low.state, change: low.change },
		limits: LIMIT_FIELDS,
		configPath: settings.configPath ?? null
	};
}
