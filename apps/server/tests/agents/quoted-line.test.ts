import { expect, test } from 'bun:test';
import { quotedLine } from '../../src/agents/quoted-line';

test('a credential the cut would split is removed before the cut', () => {
	const key = 'sk-made-up-key-0123456789abcdef';
	const quote = quotedLine(`Authorization: Bearer ${key}`, 30);

	expect(quote).not.toContain(key.slice(0, 8));
});
