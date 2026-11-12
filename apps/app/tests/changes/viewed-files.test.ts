import { afterEach, describe, expect, test } from 'bun:test';
import type { FileDiff } from '@recoder/shared';

import { isViewedAt, readViewed, toggleViewed, viewedKey, writeViewed } from '../../src/lib/changes/viewed-files';
import { addedHunk, memoryStorage } from '../fixtures';

const KEY = viewedKey('r1', 7);

function file(lines: number): FileDiff {
	return { path: 'src/a.ts', additions: lines, deletions: 0, hunks: [addedHunk(1, lines)] };
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('viewed files', () => {
	test('a file marked viewed reads as not viewed once its diff changes', () => {
		const marks = toggleViewed({}, file(2));

		expect(isViewedAt(marks, file(2))).toBe(true);
		expect(isViewedAt(marks, file(3))).toBe(false);
	});

	test('toggling a viewed file unmarks it, and toggling a changed one marks it again at the new diff', () => {
		const marks = toggleViewed({}, file(2));

		expect(toggleViewed(marks, file(2))).toEqual({});
		expect(isViewedAt(toggleViewed(marks, file(3)), file(3))).toBe(true);
	});

	test('marks survive a reload through storage, and entries that are not hashes are dropped', () => {
		globalThis.localStorage = memoryStorage();

		writeViewed(KEY, toggleViewed({}, file(2)));
		localStorage.setItem(viewedKey('r1', 8), JSON.stringify({ 'src/a.ts': 3, 'src/b.ts': 'x' }));

		expect(isViewedAt(readViewed(KEY), file(2))).toBe(true);
		expect(readViewed(viewedKey('r1', 8))).toEqual({ 'src/b.ts': 'x' });
	});

	test('blocked storage reads as nothing viewed and saving does not throw', () => {
		const blocked = memoryStorage();

		blocked.getItem = () => {
			throw new Error('SecurityError');
		};

		blocked.setItem = () => {
			throw new Error('SecurityError');
		};

		globalThis.localStorage = blocked;

		expect(readViewed(KEY)).toEqual({});
		expect(() => writeViewed(KEY, { 'src/a.ts': 'h' })).not.toThrow();
	});
});
