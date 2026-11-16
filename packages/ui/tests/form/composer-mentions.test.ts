import { describe, expect, test } from 'bun:test';

import { typedMention, withMention } from '../../src/components/form/composer-mentions';

describe('typedMention', () => {
	test('finds an at sign and the name typed after it anywhere before the caret', () => {
		expect(typedMention('@', 1)).toEqual({ start: 0, query: '' });
		expect(typedMention('use @gig', 8)).toEqual({ start: 4, query: 'gig' });
		expect(typedMention('use @gig and more', 8)).toEqual({ start: 4, query: 'gig' });
	});

	test('is null for an at sign inside a word or a name the caret has left', () => {
		expect(typedMention('mail me@example.com', 19)).toBeNull();
		expect(typedMention('use @giga-ui now', 16)).toBeNull();
		expect(typedMention('use @giga-ui ', 13)).toBeNull();
	});
});

describe('withMention', () => {
	test('replaces what was typed with the name and a space, the caret after the space', () => {
		const text = 'use @gi please';
		const picked = withMention(text, 7, { start: 4, query: 'gi' }, 'giga-ui');

		expect(picked).toEqual({ text: 'use @giga-ui please', caret: 13 });
	});

	test('adds a space at the end of the text', () => {
		expect(withMention('@gi', 3, { start: 0, query: 'gi' }, 'giga-ui')).toEqual({ text: '@giga-ui ', caret: 9 });
	});
});
