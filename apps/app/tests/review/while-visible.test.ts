import { afterEach, beforeEach, expect, jest, test } from 'bun:test';

import { afterVisible } from '../../src/lib/review/while-visible';

/** A document whose visibility a test flips; listeners hear each change. */
const page = {
	visibilityState: 'visible' as 'visible' | 'hidden',
	listeners: new Set<() => void>(),
	addEventListener(_type: string, listener: () => void) {
		this.listeners.add(listener);
	},
	removeEventListener(_type: string, listener: () => void) {
		this.listeners.delete(listener);
	}
};

function show(state: 'visible' | 'hidden'): void {
	page.visibilityState = state;

	for (const listener of [...page.listeners]) listener();
}

beforeEach(() => {
	jest.useFakeTimers();
	page.visibilityState = 'visible';
	page.listeners.clear();
	Object.assign(globalThis, { document: page });
});

afterEach(() => {
	jest.useRealTimers();
	Reflect.deleteProperty(globalThis, 'document');
});

test('a poll due while the page is hidden waits until it shows, then runs once', () => {
	let runs = 0;

	afterVisible(4000, () => runs++);
	show('hidden');
	jest.advanceTimersByTime(60000);

	expect(runs).toBe(0);

	show('visible');
	show('hidden');
	show('visible');

	expect(runs).toBe(1);
	expect(page.listeners.size).toBe(0);
});

test('a cancelled poll never runs, even when the page shows again', () => {
	let runs = 0;
	const cancel = afterVisible(4000, () => runs++);

	show('hidden');
	jest.advanceTimersByTime(5000);
	cancel();
	show('visible');

	expect(runs).toBe(0);
	expect(page.listeners.size).toBe(0);
});
