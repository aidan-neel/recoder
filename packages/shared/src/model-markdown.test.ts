import { expect, test } from 'bun:test';
import { normalizeModelMarkdown } from './model-markdown';

test('literal \\n escapes in a one-line reply become real line breaks', () => {
	expect(normalizeModelMarkdown('I checked `refill()`.\\n\\nTwo problems:\\n- `tokens` goes negative\\n- the timer leaks'))
		.toBe('I checked `refill()`.\n\nTwo problems:\n\n- `tokens` goes negative\n- the timer leaks');
});

test('text that already has line breaks keeps a "\\n" written in code', () => {
	const text = 'Split on newlines:\n\n`line.split("\\n")`';
	expect(normalizeModelMarkdown(text)).toBe(text);
});

test('a reply wrapped whole in a markdown fence is unwrapped', () => {
	expect(normalizeModelMarkdown('```markdown\nLooks fine.\n\n- one\n```')).toBe('Looks fine.\n\n- one');
});

test('headings become bold lines, and stay plain while the line is still streaming', () => {
	expect(normalizeModelMarkdown('## Summary\nAll good.')).toBe('**Summary**\nAll good.');
	expect(normalizeModelMarkdown('## Summ', { complete: false })).toBe('Summ');
});

test('code fences are left untouched', () => {
	const text = 'Run this:\n\n```sh\n# comment\n• not a bullet\n```';
	expect(normalizeModelMarkdown(text)).toBe(text);
});

test('unicode bullets become markdown bullets', () => {
	expect(normalizeModelMarkdown('Issues:\n\n• first\n• second')).toBe('Issues:\n\n- first\n- second');
});

test('an unclosed bold or backtick is dropped once the reply is complete, not while streaming', () => {
	expect(normalizeModelMarkdown('This is **important and `foo')).toBe('This is important and foo');
	expect(normalizeModelMarkdown('This is **important', { complete: false })).toBe('This is **important');
	expect(normalizeModelMarkdown('Use `a` and **b**.')).toBe('Use `a` and **b**.');
});

test('an unclosed code fence is closed', () => {
	expect(normalizeModelMarkdown('Try:\n\n```ts\nconst x = 1;')).toBe('Try:\n\n```ts\nconst x = 1;\n```');
});
