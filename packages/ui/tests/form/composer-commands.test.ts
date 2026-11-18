import { describe, expect, test } from 'bun:test';

import { matchItems, type ComposerCommand } from '../../src/components/form/composer-commands';

const COMMANDS: ComposerCommand[] = [
	{ name: 'summary', description: 'What it changes and why', prompt: 'Summarize this pull request.' },
	{ name: 'review', description: 'Review it again', prompt: 'Review this pull request again.' },
	{ name: 'risks', description: 'What could break when it merges', prompt: 'What could break?' }
];

/** The names of the commands that match a query, in the order the menu lists them. */
function namesFor(query: string): string[] {
	return matchItems(COMMANDS, query).map((command) => command.name);
}

describe('matchItems', () => {
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
