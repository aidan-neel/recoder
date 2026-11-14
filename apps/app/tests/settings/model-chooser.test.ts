import { describe, expect, test } from 'bun:test';
import type { ModelEntry } from '@recoder/shared';

import { chooserGroups, shownCount, withShown } from '../../src/lib/settings/model-chooser';
import { modelCatalog } from '../../src/lib/settings/model-options';
import { queryTerms } from '../../src/lib/shell/search';

function entry(id: string, source: string): ModelEntry {
	return { id, label: id, model: id, source, provider: 'opencode', agent: 'OpenCode', baseUrl: null, apiKeySet: false };
}

const entries = [
	entry('opencode:openrouter/kimi-k2', 'OpenRouter'),
	entry('opencode:anthropic/claude-haiku-4-5', 'Anthropic'),
	entry('opencode:openrouter/qwen3-coder', 'OpenRouter')
];

describe('model chooser', () => {
	test('groups every model by provider, A to Z, with the agent that serves it', () => {
		const groups = chooserGroups(entries, []);

		expect(groups.map((group) => [group.heading, group.agent, group.options.length])).toEqual([
			['Anthropic', 'opencode', 1],
			['OpenRouter', 'opencode', 2]
		]);
	});

	test('a search keeps the matching models and drops a provider with none', () => {
		const groups = chooserGroups(entries, queryTerms('qwen'));

		expect(groups.map((group) => group.options.map((option) => option.id))).toEqual([
			['opencode:openrouter/qwen3-coder']
		]);
	});

	test('a plain endpoint has no agent mark', () => {
		const [group] = chooserGroups([{ ...entry('local/model', 'Local'), provider: 'openai-compatible' }], []);

		expect(group.agent).toBe('');
	});

	test('counts the models the pickers still offer', () => {
		const { options } = modelCatalog(entries).groups[1];

		expect(shownCount(options, new Set([options[0].id]))).toBe(1);
	});

	test('hides and shows ids in a sorted list without repeats', () => {
		const hidden = withShown(['b'], ['c', 'a', 'b'], false);

		expect(hidden).toEqual(['a', 'b', 'c']);
		expect(withShown(hidden, ['b', 'z'], true)).toEqual(['a', 'c']);
	});
});
