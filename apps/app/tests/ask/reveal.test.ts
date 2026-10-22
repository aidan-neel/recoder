import { describe, expect, test } from 'bun:test';

import { revealEnd } from '../../src/lib/ask/reveal';

/** One 16ms frame at the base rate reveals a single character. */
const FRAME = 16;

describe('revealEnd', () => {
	test('a step that stops inside an inline code span reveals the whole span', () => {
		const text = 'Requests carry no `x-tenant-identifier-header` at all';
		const shown = text.indexOf('`') + 1;

		expect(text.slice(0, revealEnd(text, shown, FRAME))).toBe('Requests carry no `x-tenant-identifier-header`');
	});

	test('a span whose closing backtick has not arrived types out like prose', () => {
		const text = 'Requests carry no `x-tenant-identifier';
		const shown = text.indexOf('`') + 1;

		expect(revealEnd(text, shown, FRAME)).toBe(shown + 1);
	});

	test('backticks inside a fenced block do not pull the reveal forward', () => {
		const text = 'Run:\n\n```sh\necho `date` --and-a-long-flag-name\n```';
		const shown = text.indexOf('--') + 1;

		expect(revealEnd(text, shown, FRAME)).toBe(shown + 1);
	});
});
