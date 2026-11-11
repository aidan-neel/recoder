import { expect, test } from 'bun:test';

import { defaultEffort, endpointProviderName, migrateSubagentCap, resolveEffort } from '../src/models';

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

test('a subagent cap saved before 3, 8 and 12 moves up to the nearest cap that is as generous', () => {
	expect([0, 1, 2, 3, 4, 8, 9, 12, 40].map(migrateSubagentCap)).toEqual([0, 3, 3, 3, 8, 8, 12, 12, 12]);
	expect(migrateSubagentCap('uncapped')).toBe('uncapped');
});

test('an endpoint is named for the service it is, "Local endpoint" for a local address, else its host', () => {
	expect(endpointProviderName('https://openrouter.ai/api/v1')).toBe('OpenRouter');
	expect(endpointProviderName('http://192.168.1.5:8000/v1')).toBe('Local endpoint');
	expect(endpointProviderName('https://llm.example.com/v1')).toBe('llm.example.com');
	expect(endpointProviderName('not a url')).toBe('OpenAI-compatible');
});
