import { expect, test } from 'bun:test';

import { matchSections, SETTINGS_SECTIONS } from '../../src/lib/settings/sections';

/** The ids of the sections a search keeps, in order. */
function search(query: string): string[] {
	return matchSections(SETTINGS_SECTIONS, query).map((section) => section.id);
}

test('a search keeps the sections whose name or keywords hold every word, ignoring case', () => {
	expect(search('DARK')).toEqual(['appearance']);
	expect(search('token budget')).toEqual(['limits']);
	expect(search('gitlab token')).toEqual(['connections']);
});

test('a blank search keeps every section, and an unknown word keeps none', () => {
	expect(search('   ')).toHaveLength(SETTINGS_SECTIONS.length);
	expect(search('zebra')).toEqual([]);
});
