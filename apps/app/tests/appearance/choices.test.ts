import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { PALETTE, readChoice } from '../../src/lib/appearance/choices';
import { memoryStorage } from '../fixtures';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

beforeEach(() => {
	Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
});

afterEach(() => {
	if (original) Object.defineProperty(globalThis, 'localStorage', original);
	else Reflect.deleteProperty(globalThis, 'localStorage');
});

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
