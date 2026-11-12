import {
	budgetApplies,
	budgetDescription,
	TOKEN_BUDGETS,
	TOKEN_BUDGET_PLANS,
	type BudgetModels,
	type ModelSettings,
	type SubagentCap,
	type TokenBudget
} from '@recoder/shared';

import { rolePick } from './model-options';

/** The two model picks as the budget sees them: what efforts each offers, and whether the subagent pick follows the Review model. */
export function budgetModels(settings: ModelSettings): BudgetModels {
	const specialist = rolePick(settings, 'specialist');

	return {
		orchestrator: rolePick(settings, 'orchestrator').option,
		specialist: specialist.follows ? 'follows' : specialist.option
	};
}

/**
 * The budget the pick shows: the saved one, or Custom once the subagent cap (`cap`, which may be a change still
 * saving) or an effort no longer matches what it sets.
 */
export function shownBudget(settings: ModelSettings, cap: SubagentCap): TokenBudget | 'custom' {
	const saved = settings.tokenBudget;

	return budgetApplies(saved, { ...settings, subagentCap: cap }, budgetModels(settings)) ? saved : 'custom';
}

/** What the budget segmented control shows: its value, options and the line under the row's name. */
export interface BudgetControl {
	/** The control's value: a budget, or `custom` once a hand change broke the plan. */
	value: TokenBudget | 'custom';
	/** The picks; Custom joins them only while `value` is custom, and is not itself pickable back. */
	options: { value: string; label: string }[];
	/** The description line: the saved budget's words under Custom. */
	description: string;
}

const BUDGET_OPTIONS = TOKEN_BUDGETS.map((budget) => ({ value: budget, label: TOKEN_BUDGET_PLANS[budget].label }));

const CUSTOM_OPTION = { value: 'custom', label: 'Custom' };

/**
 * The token-budget row's control. A pick sets the subagent cap and both
 * reasoning efforts together; Custom joins the options while one of those has
 * been changed by hand, and choosing a budget again takes it away.
 */
export function budgetControl(shown: TokenBudget | 'custom', saved: TokenBudget): BudgetControl {
	const custom = shown === 'custom';

	return {
		value: shown,
		options: custom ? [...BUDGET_OPTIONS, CUSTOM_OPTION] : BUDGET_OPTIONS,
		description: budgetDescription(custom ? saved : shown, custom)
	};
}
