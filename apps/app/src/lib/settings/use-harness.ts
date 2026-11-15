'use client';

import { useState } from 'react';
import {
	DEFAULT_SUBAGENT_CAP,
	MAX_SUBAGENT_CAP,
	TOKEN_BUDGET_PLANS,
	budgetPatch,
	isSubagentPreset,
	subagentCapFromChoice,
	subagentCapText,
	subagentChoice,
	tokenBudgetFrom,
	type SubagentCap,
	type SubagentChoice,
	type TokenBudget
} from '@recoder/shared';

import { LIMIT_FIELDS, parseLimit } from './limits';
import { useSettings } from './settings-store';
import { budgetControl, budgetModels, shownBudget, type BudgetControl } from './token-budget';
import { useNumberField, type LimitFieldView } from './use-number-field';
import { useInstantSave, type SaveState } from './use-save-state';

const FAILED = 'Settings weren’t saved';

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

/** The Limits section once the settings have loaded. */
export interface HarnessReady {
	ready: true;
	budget: HarnessBudget;
	/** The subagent cap on screen (a budget draft can set it), its explanation and its save state. */
	subagents: {
		/** The segmented pick: a named count, Custom, or Uncapped. */
		value: SubagentChoice;
		text: string;
		state: SaveState;
		/** Saves a cap picked from `SUBAGENT_OPTIONS` (its string value). */
		change: (value: string) => void;
		/** The count stepper, only while Custom is selected. */
		custom: LimitFieldView | null;
	};
	/** The low-severity switch: on means reviews report every severity. */
	low: { on: boolean; state: SaveState; change: (on: boolean) => void };
	/** The review limit fields. */
	limits: typeof LIMIT_FIELDS;
	/** Where the settings are saved, when the server reports a path. */
	configPath: string | null;
}

/** Settings → Limits before its settings load: the section shows nothing yet. */
interface HarnessPending {
	ready: false;
}

/** Everything the Limits section shows and does. */
export type HarnessView = HarnessPending | HarnessReady;

/**
 * Settings → Limits: the token budget, how many subagents a review
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

	const [lastCustom, setLastCustom] = useState(DEFAULT_SUBAGENT_CAP);
	const [heldCustom, setHeldCustom] = useState(false);

	const picked = budget.draft?.value;
	const capDraft = cap.draft?.value;
	let capValue: SubagentCap = settings?.subagentCap ?? DEFAULT_SUBAGENT_CAP;

	if (capDraft !== undefined) capValue = capDraft;
	if (picked) capValue = TOKEN_BUDGET_PLANS[picked].subagentCap;

	const customCount = typeof capValue === 'number' ? capValue : lastCustom;

	/** Keep the last Custom count so leaving a named pick can restore it. */
	function rememberCustom(next: SubagentCap): void {
		if (typeof next === 'number' && !isSubagentPreset(next)) setLastCustom(next);
	}

	const custom = useNumberField({
		value: customCount,
		min: 0,
		max: MAX_SUBAGENT_CAP,
		current: () => {
			const now = useSettings.getState().models?.subagentCap;

			return typeof now === 'number' ? now : lastCustom;
		},
		save: (value) => {
			rememberCustom(value);

			return useSettings.getState().saveModels({ subagentCap: value });
		},
		parse: (text) => parseLimit(text, MAX_SUBAGENT_CAP, 0)
	});

	if (!settings) return { ready: false };

	const shown = picked ?? shownBudget(settings, capValue);
	const choice = heldCustom ? 'custom' : subagentChoice(capValue);
	const capState = cap.state !== 'idle' || choice !== 'custom' ? cap.state : custom.state;

	return {
		ready: true,
		budget: {
			shown,
			saved: settings.tokenBudget,
			control: budgetControl(shown, settings.tokenBudget),
			state: budget.state,
			change: (value) => {
				const next = tokenBudgetFrom(value);

				if (!next) return;

				setHeldCustom(false);
				budget.change(next);
				rememberCustom(TOKEN_BUDGET_PLANS[next].subagentCap);
			}
		},
		subagents: {
			value: choice,
			text: subagentCapText(capValue),
			state: capState,
			change: (value) => {
				if (value === 'custom') {
					setHeldCustom(true);

					const next = subagentCapFromChoice(value, capValue, lastCustom);

					rememberCustom(next);

					if (next !== capValue) cap.change(next);

					return;
				}

				setHeldCustom(false);
				rememberCustom(capValue);
				cap.change(subagentCapFromChoice(value, capValue));
			},
			custom: choice === 'custom' ? custom : null
		},
		low: { on: low.draft ? low.draft.value : settings.reportLowSeverity, state: low.state, change: low.change },
		limits: LIMIT_FIELDS,
		configPath: settings.configPath ?? null
	};
}
