import { describe, expect, test } from 'bun:test';
import type { ModelEntry } from '@recoder/shared';

import { modelCatalog, queryTerms } from '../../src/lib/settings/model-options';
import { FOLLOW_ID, layoutRows, mountedRows, stepChoice } from '../../src/lib/settings/model-rows';

function entry(id: string, source: string): ModelEntry {
	return { id, label: id, model: id, source, agent: 'OpenCode', baseUrl: null, apiKeyPreview: null };
}

/** Two providers of three models each: rows are heading, 3 models, heading, 3 models. */
const catalog = modelCatalog([
	entry('opencode:anthropic/claude-haiku-4-5', 'Anthropic'),
	entry('opencode:anthropic/claude-sonnet-4-5', 'Anthropic'),
	entry('opencode:anthropic/claude-opus-4-1', 'Anthropic'),
	entry('opencode:openrouter/glm-5.3-flash', 'OpenRouter'),
	entry('opencode:openrouter/kimi-k2', 'OpenRouter'),
	entry('opencode:openrouter/qwen3-coder', 'OpenRouter')
]);

const layout = layoutRows(catalog.groups, [], true, 1);
const keyOf = (index: number | null) => (index === null ? null : layout.rows[index].key);

describe('model rows', () => {
	test('a search drops providers with no match, heading and all, and the follow row unless it matches', () => {
		const rows = layoutRows(catalog.groups, queryTerms('kimi'), true, 1).rows;

		expect(rows.map((row) => row.key)).toEqual(['heading:OpenRouter', 'opencode:openrouter/kimi-k2']);
		expect(layoutRows(catalog.groups, queryTerms('same'), true, 1).rows.map((row) => row.key)).toEqual([FOLLOW_ID]);
	});

	test('arrows skip headings and wrap around the ends', () => {
		expect(keyOf(stepChoice(layout, 'opencode:anthropic/claude-opus-4-1', 'ArrowDown'))).toBe(
			'opencode:openrouter/glm-5.3-flash'
		);

		expect(keyOf(stepChoice(layout, 'opencode:openrouter/qwen3-coder', 'ArrowDown'))).toBe(FOLLOW_ID);
		expect(keyOf(stepChoice(layout, FOLLOW_ID, 'ArrowUp'))).toBe('opencode:openrouter/qwen3-coder');
	});

	test('page keys stop at the ends instead of wrapping', () => {
		expect(keyOf(stepChoice(layout, 'opencode:anthropic/claude-sonnet-4-5', 'PageDown'))).toBe(
			'opencode:openrouter/qwen3-coder'
		);

		expect(keyOf(stepChoice(layout, 'opencode:anthropic/claude-sonnet-4-5', 'PageUp'))).toBe(FOLLOW_ID);
	});

	test('with nothing selected, down lands on the first row and up on the last', () => {
		expect(keyOf(stepChoice(layout, null, 'ArrowDown'))).toBe(FOLLOW_ID);
		expect(keyOf(stepChoice(layout, 'gone-model', 'ArrowUp'))).toBe('opencode:openrouter/qwen3-coder');
	});

	test('the selected row stays mounted after it scrolls far out of view', () => {
		const last = layout.rows.length - 1;

		expect(mountedRows(layout, 0, 40, 0, [])).not.toContain(last);
		expect(mountedRows(layout, 0, 40, 0, [last])).toContain(last);
	});

	test('rows and the list padding grow with the root font, as the CSS rows compiled to rem do', () => {
		const large = layoutRows(catalog.groups, [], true, 1.125);

		expect(large.total).toBe(layout.total * 1.125);
		expect(large.pad).toBe(layout.pad * 1.125);
	});
});
