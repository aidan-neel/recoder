import { describe, expect, test } from 'bun:test';

import { budgetControl } from '../../src/lib/settings/token-budget';

describe('the token-budget control', () => {
	test('a saved budget shows its own options and its description', () => {
		const control = budgetControl('low', 'low');

		expect(control.value).toBe('low');
		expect(control.options.map((option) => option.value)).toEqual(['low', 'medium', 'high']);
		expect(control.description).toBe('Fewest tokens: 1 reviewer, up to 3 subagents, low effort');
	});

	test('custom joins the options only while shown, and describes the saved budget', () => {
		const control = budgetControl('custom', 'medium');

		expect(control.value).toBe('custom');
		expect(control.options.at(-1)).toEqual({ value: 'custom', label: 'Custom' });
		expect(control.options).toHaveLength(4);
		expect(control.description).toBe('Your own settings, with Medium review limits');
	});
});
