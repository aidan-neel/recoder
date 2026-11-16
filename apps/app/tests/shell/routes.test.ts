import { describe, expect, test } from 'bun:test';

import { pullHref, pullTabOf } from '../../src/lib/shell/routes';

describe('pullTabOf', () => {
	test('opens the Review tab from an old link that names the Bugs tab', () => {
		expect(pullTabOf('bugs')).toBe('review');
	});

	test('falls back to Changes for no tab or one the page does not have', () => {
		expect(pullTabOf(null)).toBe('changes');
		expect(pullTabOf('constructor')).toBe('changes');
	});

	test('reads back the tab a pull request link names', () => {
		const tab = new URL(pullHref('', 'r1', 12, 'review'), 'http://app').searchParams.get('tab');

		expect(pullTabOf(tab)).toBe('review');
	});
});
