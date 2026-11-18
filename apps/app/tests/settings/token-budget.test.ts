import { describe, expect, test } from 'bun:test';

import { budgetControl } from '../../src/lib/settings/token-budget';

describe('the token-budget control', () => {
	test('custom joins the options only while shown, and describes the saved budget', () => {
		const control = budgetControl('custom', 'medium');

		expect(control.value).toBe('custom');
		expect(control.options.at(-1)).toEqual({ value: 'custom', label: 'Custom' });
		expect(control.options).toHaveLength(4);
		expect(control.description).toBe('Your own settings, with Medium review limits');
	});
});
