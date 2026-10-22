import { describe, expect, test } from 'bun:test';

import { paletteScore } from '../../src/lib/shell/palette-filter';

describe('paletteScore', () => {
	test('a keyword matches only from its start, never on scattered letters', () => {
		expect(paletteScore('Add CSV export to the billing page web #205', 'csv')).toBeGreaterThan(0);
		expect(paletteScore('Cache project lists per organization api #198', 'csv', ['acme/api', 'devin[bot]'])).toBe(0);
		expect(paletteScore('Agent settings', 'csv', ['settings', 'model', 'provider'])).toBe(0);
		expect(paletteScore('Agent settings', 'prov', ['settings', 'model', 'provider'])).toBeGreaterThan(0);
	});

	test('every typed word must match, and a match in the row text ranks above a keyword match', () => {
		expect(paletteScore('Add CSV export', 'csv billing')).toBe(0);

		const inText = paletteScore('Switch between light and dark', 'dark', ['theme']);
		const byKeyword = paletteScore('Appearance settings', 'dark', ['dark', 'light']);

		expect(inText).toBeGreaterThan(byKeyword);
	});
});
