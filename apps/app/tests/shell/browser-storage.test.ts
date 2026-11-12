import { afterEach, describe, expect, test } from 'bun:test';

import { writeStored } from '../../src/lib/shell/browser-storage';
import { memoryStorage } from '../fixtures';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Puts a storage in place whose writes throw `error`. */
function storageThatThrows(error: Error): void {
	const storage: Storage = {
		...memoryStorage(),
		setItem: () => {
			throw error;
		}
	};

	Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

afterEach(() => {
	if (original) Object.defineProperty(globalThis, 'localStorage', original);
	else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('saving to browser storage', () => {
	test('storage that is full keeps the value for this page only', () => {
		storageThatThrows(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));

		expect(() => writeStored('key', 'value')).not.toThrow();
	});

	test('a failure that is not the browser refusing storage is thrown again', () => {
		storageThatThrows(new TypeError('setItem is not a function'));

		expect(() => writeStored('key', 'value')).toThrow('setItem is not a function');
	});
});
