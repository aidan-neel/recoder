import { expect, test } from 'bun:test';
import { findingTitle } from '../../../web/src/lib/finding-title';

test('finding titles prefer authored text and support older Markdown findings', () => {
	expect(findingTitle('The detailed explanation.', 'Compare semantic versions')).toBe('Compare semantic versions');
	expect(findingTitle('### **Reject missing versions**\n\nThe registry can omit a component.')).toBe('Reject missing versions');
	expect(findingTitle('This assertion is tautological: it compares values derived from the same output.')).toBe('This assertion is tautological');
	expect(findingTitle('Refill ignores the clock. Use the injected clock instead.', '  ')).toBe('Refill ignores the clock');
});

test('title fallbacks preserve code punctuation and stay compact for long legacy descriptions', () => {
	expect(findingTitle('`outdated: installed < latest` compares raw strings. Parse the versions first.')).toBe('outdated: installed < latest compares raw strings');
	expect(findingTitle('See [the comparison](https://example.com) for the regression.')).toBe('See the comparison for the regression');
	const long = findingTitle('The configured component is absent from the registry and is silently treated as current even though no comparison was possible');
	expect(long.length).toBeLessThanOrEqual(96);
	expect(long.endsWith('…')).toBe(true);
	expect(findingTitle('')).toBe('Review finding');
});
