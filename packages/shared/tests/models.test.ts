import { expect, test } from 'bun:test';

import {
	DEFAULT_SUBAGENT_CAP,
	customSubagentCount,
	defaultEffort,
	endpointProviderName,
	resolveEffort,
	subagentCapFromChoice,
	subagentChoice
} from '../src/models';

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

test('3 and 6 are named picks; any other count is Custom', () => {
	expect(subagentChoice(3)).toBe('3');
	expect(subagentChoice(6)).toBe('6');
	expect(subagentChoice('uncapped')).toBe('uncapped');
	expect([0, 1, 8, 12].map(subagentChoice)).toEqual(['custom', 'custom', 'custom', 'custom']);
});

test('Custom keeps a count that is not 3 or 6, and uses the fallback for those and Uncapped', () => {
	expect([0, 1, 2, 4, 8, 12, 40].map((n) => customSubagentCount(n))).toEqual([0, 1, 2, 4, 8, 12, 40]);
	expect(customSubagentCount(3)).toBe(DEFAULT_SUBAGENT_CAP);
	expect(customSubagentCount(6)).toBe(DEFAULT_SUBAGENT_CAP);
	expect(customSubagentCount('uncapped')).toBe(DEFAULT_SUBAGENT_CAP);
	expect(customSubagentCount(3, 12)).toBe(12);
});

test('a Settings pick becomes its cap; Custom keeps the current custom count', () => {
	expect(subagentCapFromChoice('3', 8)).toBe(3);
	expect(subagentCapFromChoice('6', 0)).toBe(6);
	expect(subagentCapFromChoice('uncapped', 8)).toBe('uncapped');
	expect(subagentCapFromChoice('custom', 12)).toBe(12);
	expect(subagentCapFromChoice('custom', 3, 12)).toBe(12);
	expect(subagentCapFromChoice('custom', 'uncapped', 8)).toBe(8);
	expect(subagentCapFromChoice('nope', 8)).toBe(8);
});

test('an endpoint is named for the service it is, "Local endpoint" for a local address, else its host', () => {
	expect(endpointProviderName('https://openrouter.ai/api/v1')).toBe('OpenRouter');
	expect(endpointProviderName('http://192.168.1.5:8000/v1')).toBe('Local endpoint');
	expect(endpointProviderName('https://llm.example.com/v1')).toBe('llm.example.com');
	expect(endpointProviderName('not a url')).toBe('OpenAI-compatible');
});
