import { describe, expect, test } from 'bun:test';

import { chatText, typedText } from '../../src/lib/ask/chat-text';

describe('chatText', () => {
	test('leaves out the app’s note blocks and keeps ordinary code fences', () => {
		const reply = [
			'The bucket is shared.',
			'',
			'```ts',
			'const key = tenant ?? ip;',
			'```',
			'',
			'```recoder-note',
			'{"file":"a.ts","startLine":1,"endLine":1,"side":"new","body":"x"}',
			'```'
		].join('\n');

		expect(chatText(reply, true)).toBe('The bucket is shared.\n\n```ts\nconst key = tenant ?? ip;\n```');
	});

	test('hides a block still streaming, before its closing fence arrives', () => {
		expect(chatText('Starting the fix.\n\n```recoder-fix\n{"findings": ["f', false)).toBe('Starting the fix.');
	});
});

describe('typedText', () => {
	test('keeps the developer’s single line breaks, except inside code', () => {
		expect(typedText('first\nsecond\n\nthird\n```\na\nb\n```')).toBe('first  \nsecond\n\nthird\n```\na\nb\n```');
	});
});
