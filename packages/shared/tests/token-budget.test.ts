import { expect, test } from 'bun:test';

import { DEFAULT_SUBAGENT_CAP, TOKEN_BUDGETS, type EffortChoices } from '../src/models';
import { budgetApplies, budgetPatch, type BudgetModels } from '../src/token-budget';

const FULL: EffortChoices = { efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' };
const NARROW: EffortChoices = { efforts: ['medium', 'high'], defaultEffort: 'medium' };
const PLAIN: EffortChoices = { efforts: null, defaultEffort: null };

test('Medium saves today’s subagent cap and no effort, so every model keeps following its own default', () => {
	expect(budgetPatch('medium', { orchestrator: FULL, specialist: FULL })).toEqual({
		tokenBudget: 'medium',
		subagentCap: DEFAULT_SUBAGENT_CAP,
		orchestratorEffort: null,
		specialistEffort: null
	});
});

test('Low and High save the nearest effort a model offers and never send one to a model with no reasoning control', () => {
	expect(budgetPatch('low', { orchestrator: FULL, specialist: NARROW })).toMatchObject({
		subagentCap: 0,
		orchestratorEffort: 'low',
		specialistEffort: 'medium'
	});

	expect(budgetPatch('high', { orchestrator: NARROW, specialist: PLAIN })).toMatchObject({
		subagentCap: 4,
		orchestratorEffort: 'high',
		specialistEffort: null
	});
});

test('a subagent model that follows the Review model keeps following it', () => {
	expect(budgetPatch('high', { orchestrator: FULL, specialist: 'follows' }).specialistEffort).toBeNull();
});

test('every budget applies right after it is picked, whatever the models offer, and stops applying when one setting is changed by hand', () => {
	const setups: BudgetModels[] = [
		{ orchestrator: FULL, specialist: FULL },
		{ orchestrator: NARROW, specialist: 'follows' },
		{ orchestrator: PLAIN, specialist: PLAIN },
		{}
	];

	for (const budget of TOKEN_BUDGETS) {
		for (const models of setups) {
			const saved = budgetPatch(budget, models);

			expect(budgetApplies(budget, saved, models)).toBe(true);
			expect(budgetApplies(budget, { ...saved, subagentCap: 'uncapped' }, models)).toBe(false);
		}
	}

	const models = { orchestrator: FULL, specialist: FULL };

	expect(budgetApplies('low', { ...budgetPatch('low', models), orchestratorEffort: 'high' }, models)).toBe(false);
	expect(budgetApplies('high', { ...budgetPatch('high', models), specialistEffort: 'medium' }, models)).toBe(false);
});

test('Medium applies to a model whose saved effort is its default, as picking the model saves it', () => {
	const models = { orchestrator: FULL, specialist: FULL };

	expect(
		budgetApplies('medium', { subagentCap: 2, orchestratorEffort: 'medium', specialistEffort: 'medium' }, models)
	).toBe(true);

	expect(budgetApplies('medium', { subagentCap: 2, orchestratorEffort: 'high', specialistEffort: null }, models)).toBe(
		false
	);
});
