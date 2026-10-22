import { expect, test } from 'bun:test';

import { defaultEffort, resolveEffort } from '../src/models';

test('a model starts on the provider default it offers, else Medium, else its first effort', () => {
	expect(defaultEffort({ efforts: ['low', 'medium', 'high'], defaultEffort: 'high' })).toBe('high');
	expect(defaultEffort({ efforts: ['low', 'medium', 'high'], defaultEffort: 'max' })).toBe('medium');
	expect(defaultEffort({ efforts: ['high', 'xhigh'] })).toBe('high');
	expect(defaultEffort({ efforts: [] })).toBeNull();
});

test('a saved effort the model does not offer falls back to its default, whether efforts are names or options', () => {
	const names = { efforts: ['low', 'medium'] as const, defaultEffort: 'medium' as const };
	const options = { efforts: [{ id: 'low' as const }, { id: 'medium' as const }], defaultEffort: 'medium' as const };

	expect(resolveEffort(names, 'low')).toBe('low');
	expect(resolveEffort(names, 'max')).toBe('medium');
	expect(resolveEffort(options, 'low')).toBe('low');
	expect(resolveEffort(options, null)).toBe('medium');
	expect(resolveEffort({ efforts: null, defaultEffort: null }, 'high')).toBeNull();
});
