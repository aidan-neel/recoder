import { describe, expect, test } from 'bun:test';

import {
	caretAt,
	firstRule,
	globalSummary,
	seedText,
	streamingDraft,
	trimEmptyBullets
} from '../../src/lib/guidelines/rules';

const TEMPLATE = '## Focus\n-\n\n## Ignore\n-\n\n## Severity\n-\n\n## Conventions\n-\n';

describe('the first rule of a guidelines text', () => {
	test('the starter template has no rule, so its bare bullets never read as one', () => {
		expect(firstRule(TEMPLATE)).toBeNull();
	});

	test('skips headings, blank lines and "None." and drops the bullet', () => {
		expect(firstRule('## Ignore\n- None.\n\n## Focus\n*   Check auth on new routes\n')).toBe(
			'Check auth on new routes'
		);
	});
});

describe('opening the starter template', () => {
	test('the caret lands in the first empty bullet, and saving leaves no line ending in a space', () => {
		const seed = seedText(null, TEMPLATE);

		expect(seed.slice(0, caretAt(seed))).toBe('## Focus\n- ');
		expect(trimEmptyBullets(seed)).toBe(TEMPLATE);
	});
});

describe('the global row', () => {
	const neverSaved = globalSummary({ content: '', updatedAt: null });

	test('a layer never saved reads as Recoder’s defaults even though it holds their text', () => {
		const defaults = globalSummary({ content: '## Focus\n- Report what blocks a merge\n', updatedAt: null });

		expect(defaults).toBe(neverSaved);
		expect(defaults).not.toContain('Report what blocks a merge');
	});

	test('a layer saved empty is not mistaken for the defaults', () => {
		expect(globalSummary({ content: '', updatedAt: '2026-10-17T00:00:00Z' })).not.toBe(neverSaved);
	});
});

describe('a draft while it streams', () => {
	test('hides an opening fence that has not finished its line yet', () => {
		expect(streamingDraft('```mark')).toBe('');
		expect(streamingDraft('``')).toBe('');
	});

	test('hides a whole-document fence, including a closing fence still arriving', () => {
		expect(streamingDraft('```markdown\n## Focus\n- Auth\n``')).toBe('## Focus\n- Auth');
		expect(streamingDraft('```\n## Focus\n- Auth')).toBe('## Focus\n- Auth');
	});

	test('keeps backticks that belong to the rules', () => {
		expect(streamingDraft('## Focus\n- Use `Decimal` for money\n```')).toBe('## Focus\n- Use `Decimal` for money\n```');
		expect(streamingDraft('```md\n- Wrap `fetch` in `retry')).toBe('- Wrap `fetch` in `retry');
	});
});
