import { describe, expect, test } from 'bun:test';

import type { ComposerCommand } from '../../src/components/form/composer-commands';
import { slashRows, typedSlash, withPick, withSlash } from '../../src/components/form/composer-slash';

const REVIEW: ComposerCommand = {
	name: 'review',
	description: 'Review it again',
	prompt: 'Review this pull request again.'
};

const SKILLS = [
	{ name: 'giga-ui', description: 'Interface craft' },
	{ name: 'review', description: 'How this team reviews' }
];

describe('typedSlash', () => {
	test('finds a slash and the name typed after it, at the start or after a space', () => {
		expect(typedSlash('/', 1)).toEqual({ start: 0, query: '' });
		expect(typedSlash('use /gig', 8)).toEqual({ start: 4, query: 'gig' });
		expect(typedSlash('use /gig and more', 8)).toEqual({ start: 4, query: 'gig' });
	});

	test('is null for a slash inside a path or a name the caret has left', () => {
		expect(typedSlash('see src/app', 11)).toBeNull();
		expect(typedSlash('use /giga-ui now', 16)).toBeNull();
		expect(typedSlash('use /giga-ui ', 13)).toBeNull();
	});
});

describe('slashRows', () => {
	test('lists the commands before the skills and keeps a command and a skill of one name apart', () => {
		const rows = slashRows([REVIEW], SKILLS, 're');

		expect(rows.map((row) => `${row.kind}:${row.item.name}`)).toEqual(['command:review', 'skill:review']);
	});
});

describe('withPick', () => {
	test('puts a skill as its name and a space in place of what was typed, the caret after the space', () => {
		const text = 'use /gi please';
		const picked = withPick(text, 7, { start: 4, query: 'gi' }, { kind: 'skill', item: SKILLS[0]! });

		expect(picked).toEqual({ text: 'use /giga-ui please', caret: 13 });
	});

	test('puts a command prompt in place of what was typed and keeps the words before it', () => {
		const picked = withPick('focus on auth /rev', 18, { start: 14, query: 'rev' }, { kind: 'command', item: REVIEW });

		expect(picked).toEqual({ text: 'focus on auth Review this pull request again.', caret: 45 });
	});
});

describe('withSlash', () => {
	test('types a slash at the caret, after a space when a word ends there', () => {
		expect(withSlash('', 0)).toEqual({ text: '/', caret: 1 });
		expect(withSlash('fix auth', 8)).toEqual({ text: 'fix auth /', caret: 10 });
		expect(withSlash('fix ', 4)).toEqual({ text: 'fix /', caret: 5 });
	});
});
