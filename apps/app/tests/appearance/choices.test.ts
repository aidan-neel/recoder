import { describe, expect, test } from 'bun:test';

import { PALETTE, readChoice } from '../../src/lib/appearance/choices';
import { useMemoryStorage } from '../fixtures';

useMemoryStorage();

describe('reading the saved palette', () => {
	test('a saved palette comes back as the pick', () => {
		localStorage.setItem(PALETTE.key, 'teal');

		expect(readChoice(PALETTE)).toBe('teal');
	});

	test('a saved value that is no longer a palette falls back to the default', () => {
		localStorage.setItem(PALETTE.key, 'ocean');

		expect(readChoice(PALETTE)).toBe(PALETTE.fallback);
	});

	test('nothing saved gives the default', () => {
		expect(readChoice(PALETTE)).toBe(PALETTE.fallback);
	});
});
