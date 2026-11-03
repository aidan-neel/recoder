import {
	budgetApplies,
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
