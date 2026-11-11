'use client';

import {
	TOKEN_BUDGETS,
	TOKEN_BUDGET_PLANS,
	budgetDescription,
	tokenBudgetFrom,
	type TokenBudget
} from '@recoder/shared';
import { SegmentedControl } from '@recoder/ui';

import type { SaveState } from '@/lib/settings/use-save-state';

import { SaveStatus } from './save-status';
import { SettingsRow } from './settings-group';

const OPTIONS = TOKEN_BUDGETS.map((budget) => ({ value: budget, label: TOKEN_BUDGET_PLANS[budget].label }));

const CUSTOM = { value: 'custom', label: 'Custom' };

interface BudgetRowProps {
	/** The budget on screen, or Custom once the subagent cap or an effort was changed by hand. */
	shown: TokenBudget | 'custom';
	/** The saved budget, whose review limits still apply under Custom. */
	saved: TokenBudget;
	state: SaveState;
	onChange: (budget: TokenBudget) => void;
}

/**
 * How many tokens a review may spend: Low, Medium or High. A pick sets the subagent cap and both reasoning
 * efforts together and how long reviewers run. Custom joins them while one of those has been changed by hand,
 * and is not something to pick: choosing a budget again takes it away.
 */
export function BudgetRow({ shown, saved, state, onChange }: BudgetRowProps) {
	function change(value: string): void {
		const budget = tokenBudgetFrom(value);

		if (budget) onChange(budget);
	}

	return (
		<SettingsRow
			name="Token budget"
			description={shown === 'custom' ? budgetDescription(saved, true) : budgetDescription(shown, false)}
		>
			<SaveStatus state={state} />
			<SegmentedControl
				aria-label="Token budget"
				value={shown}
				onValueChange={change}
				options={shown === 'custom' ? [...OPTIONS, CUSTOM] : OPTIONS}
			/>
		</SettingsRow>
	);
}
