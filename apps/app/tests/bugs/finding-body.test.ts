import { describe, expect, test } from 'bun:test';

import { splitLead } from '../../src/lib/bugs/finding-body';

describe('splitLead', () => {
	test('the first paragraph leads and the rest follows it', () => {
		expect(splitLead('What is wrong.\n\n- one\n- two\n\nWhy it matters.')).toEqual({
			lead: 'What is wrong.',
			rest: '- one\n- two\n\nWhy it matters.'
		});
	});

	test('one paragraph is all lead', () => {
		expect(splitLead('  What is wrong,\nover two lines.  ')).toEqual({
			lead: 'What is wrong,\nover two lines.',
			rest: ''
		});
	});

	test.each([
		['a list', '- one\n- two\n\nAfter.'],
		['a heading', '## Cause\n\nAfter.'],
		['a fence', '```ts\nconst a = 1;\n\nconst b = 2;\n```'],
		['a quote', '> quoted\n\nAfter.']
	])('an explanation that opens with %s stays whole', (_kind, text) => {
		expect(splitLead(text)).toEqual({ lead: text, rest: '' });
	});

	test('a fence that opens inside the first paragraph keeps the explanation whole', () => {
		const text = 'Runs this:\n```sh\nbun test\n\nbun run check\n```';

		expect(splitLead(text)).toEqual({ lead: text, rest: '' });
	});
});
