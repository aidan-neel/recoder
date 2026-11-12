import { expect, test } from 'bun:test';
import { quotedLine } from '../../src/agents/quoted-line';

test('a line longer than the cut is quoted from its start, where the CLI says what went wrong', () => {
	const line = `Error: rate limit reached for this plan. ${'x'.repeat(900)} trailing detail`;

	expect(quotedLine(line, 80)).toBe(line.slice(0, 80));
});

test('a credential the cut would split is removed before the cut', () => {
	const key = 'sk-made-up-key-0123456789abcdef';
	const quote = quotedLine(`Authorization: Bearer ${key}`, 30);

	expect(quote).not.toContain(key.slice(0, 8));
});
