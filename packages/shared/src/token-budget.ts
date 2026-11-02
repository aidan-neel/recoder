import {
	DEFAULT_SUBAGENT_CAP,
	REASONING_EFFORTS,
	TOKEN_BUDGETS,
	resolveEffort,
	type EffortChoices,
	type ModelSettingsPatch,
	type ReasoningEffort,
	type SubagentCap,
	type TokenBudget
} from './models';

/** A budget's settings: its name, what it trades in a line, and the two Settings it writes. */
export interface TokenBudgetPlan {
	label: string;
	description: string;
	subagentCap: SubagentCap;
	/** The reasoning effort for both models; null leaves each model on its own default. */
	effort: ReasoningEffort | null;
}

export const TOKEN_BUDGET_PLANS: Record<TokenBudget, TokenBudgetPlan> = {
	low: {
		label: 'Low',
		description: 'Fewest tokens: core reviewers, no subagents, low effort',
		subagentCap: 0,
		effort: 'low'
	},
	medium: {
		label: 'Medium',
		description: 'Balanced depth and cost, the default',
		subagentCap: DEFAULT_SUBAGENT_CAP,
		effort: null
	},
	high: {
		label: 'High',
		description: 'Most thorough: longer reviews, more subagents, high effort',
		subagentCap: 4,
		effort: 'high'
	}
};

/** The two model picks as a picker sees them; `follows` is a subagent pick left on the Review model. */
export interface BudgetModels {
	orchestrator?: EffortChoices;
	specialist?: EffortChoices | 'follows';
}

/** The saved Settings a budget writes, as `ModelSettings` carries them. */
export interface BudgetSettings {
	subagentCap: SubagentCap;
	orchestratorEffort?: ReasoningEffort | null;
	specialistEffort?: ReasoningEffort | null;
}

/** The names of the efforts a picker offers, which may list them as options with an `id`. */
function offeredEfforts(choices: EffortChoices): ReasoningEffort[] {
	return (choices.efforts ?? []).map((effort) => (typeof effort === 'string' ? effort : effort.id));
}

/** The offered effort closest to `target` in depth; the shallower one when two are equally close. */
function nearestEffort(target: ReasoningEffort, offered: ReasoningEffort[]): ReasoningEffort {
	const rank = (effort: ReasoningEffort) => REASONING_EFFORTS.indexOf(effort);
	const distance = (effort: ReasoningEffort) => Math.abs(rank(effort) - rank(target));

	return [...offered].sort((a, b) => distance(a) - distance(b) || rank(a) - rank(b))[0];
}

/**
 * The effort a model runs at under `budget`: the budget's effort or the nearest one the model offers, its own default
 * for a budget that sets none, and null for a model with no reasoning control, which is never sent one.
 */
function effortUnder(budget: TokenBudget, choices: EffortChoices | undefined): ReasoningEffort | null {
	const offered = choices ? offeredEfforts(choices) : [];
	const target = TOKEN_BUDGET_PLANS[budget].effort;

	if (!choices || !offered.length) return null;

	return target ? nearestEffort(target, offered) : choices.defaultEffort;
}

/**
 * The change that applies a budget: the budget itself, its subagent cap and each model's effort. A budget that sets
 * no effort saves none, so the model keeps following its own default; a subagent pick on the Review model keeps
 * following the Review effort.
 */
export function budgetPatch(
	budget: TokenBudget,
	models: BudgetModels
): Required<Pick<ModelSettingsPatch, 'tokenBudget' | 'subagentCap' | 'orchestratorEffort' | 'specialistEffort'>> {
	const plan = TOKEN_BUDGET_PLANS[budget];
	const saved = (choices: EffortChoices | undefined) => (plan.effort ? effortUnder(budget, choices) : null);

	return {
		tokenBudget: budget,
		subagentCap: plan.subagentCap,
		orchestratorEffort: saved(models.orchestrator),
		specialistEffort: models.specialist === 'follows' ? null : saved(models.specialist)
	};
}

/**
 * Whether the saved subagent cap and efforts are what `budget` would set. When they are not, the person has changed
 * one by hand and the budget reads as Custom, still running with that budget's limits. A subagent pick that follows
 * the Review model has no effort of its own to compare.
 */
export function budgetApplies(budget: TokenBudget, saved: BudgetSettings, models: BudgetModels): boolean {
	if (saved.subagentCap !== TOKEN_BUDGET_PLANS[budget].subagentCap) return false;

	const matches = (choices: EffortChoices | undefined, effort: ReasoningEffort | null | undefined) =>
		resolveEffort(choices, effort) === effortUnder(budget, choices);

	return (
		matches(models.orchestrator, saved.orchestratorEffort) &&
		(models.specialist === 'follows' || matches(models.specialist, saved.specialistEffort))
	);
}

/** The budget a picker's string value stands for; null for anything else, such as the Custom option. */
export function tokenBudgetFrom(value: string): TokenBudget | null {
	return TOKEN_BUDGETS.find((budget) => budget === value) ?? null;
}

/** The line under the budget pick: the budget's own, or for Custom what it still runs with. */
export function budgetDescription(budget: TokenBudget, custom: boolean): string {
	return custom
		? `Your own settings, with ${TOKEN_BUDGET_PLANS[budget].label} review limits`
		: TOKEN_BUDGET_PLANS[budget].description;
}
