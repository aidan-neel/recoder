import { describe, expect, test } from 'bun:test';

import {
	matchCommands,
	typedCommand,
	withCommand,
	type ComposerCommand
} from '../../src/components/form/composer-commands';

const COMMANDS: ComposerCommand[] = [
	{ name: 'summary', description: 'What it changes and why', prompt: 'Summarize this pull request.' },
	{ name: 'review', description: 'Review it again', prompt: 'Review this pull request again.' },
	{ name: 'risks', description: 'What could break when it merges', prompt: 'What could break?' }
];

/** The names of the commands that match a query, in the order the menu lists them. */
function namesFor(query: string): string[] {
	return matchCommands(COMMANDS, query).map((command) => command.name);
}

describe('typedCommand', () => {
	test('reads the name being typed after a leading slash, lowercased', () => {
		expect(typedCommand('/')).toBe('');
		expect(typedCommand('/Re')).toBe('re');
	});

	test('reads no command once a space follows the name or the slash is not first', () => {
		expect(typedCommand('/review now')).toBeNull();
		expect(typedCommand(' /review')).toBeNull();
		expect(typedCommand('see /review')).toBeNull();
		expect(typedCommand('')).toBeNull();
	});
});

describe('matchCommands', () => {
	test('lists every command in its own order for an empty query', () => {
		expect(namesFor('')).toEqual(['summary', 'review', 'risks']);
	});

	test('ranks names that start with the query above names and descriptions that only contain it', () => {
		expect(namesFor('r')).toEqual(['review', 'risks', 'summary']);
		expect(namesFor('break')).toEqual(['risks']);
	});

	test('matches nothing when no name or description holds the query', () => {
		expect(namesFor('deploy')).toEqual([]);
	});
});

describe('withCommand', () => {
	test('replaces a typed command name with the prompt', () => {
		expect(withCommand('/rev', COMMANDS[1]!)).toBe('Review this pull request again.');
	});

	test('keeps the words already in the field and adds the prompt after them', () => {
		expect(withCommand('  focus on auth ', COMMANDS[1]!)).toBe('focus on auth Review this pull request again.');
		expect(withCommand('', COMMANDS[0]!)).toBe('Summarize this pull request.');
	});
});
