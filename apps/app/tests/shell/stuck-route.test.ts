import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { BOOT_FAILED_ATTR, LOST_SCRIPT_ATTR } from '../../src/lib/shell/boot-script';
import { useShell } from '../../src/lib/shell/shell-store';
import { watchStuckRoute } from '../../src/lib/shell/stuck-route';

/** The mutation observer the watch makes; `current` is set while it reads the canvas, and `canvas` runs it. */
class FakeObserver {
	static current: FakeObserver | null = null;

	constructor(readonly callback: () => void) {}

	observe(): void {
		FakeObserver.current = this;
	}

	disconnect(): void {
		if (FakeObserver.current === this) FakeObserver.current = null;
	}
}

/**
 * The page as the watch sees it: `<html>`'s attributes, whether a route's
 * skeleton is up, the boot notice and the listeners.
 */
const page = {
	attributes: new Set<string>(),
	waiting: false,
	notice: false,
	listeners: new Map<string, Set<(event: Event) => void>>()
};

function listen(type: string, listener: (event: Event) => void): void {
	const set = page.listeners.get(type) ?? new Set();

	set.add(listener);
	page.listeners.set(type, set);
}

/** A script of the app fails to load after the app mounted: a navigation's code, a preload, or one added by hand. */
function loseScript(): void {
	const event = {
		target: { tagName: 'SCRIPT', src: 'http://localhost/_next/static/chunks/probe.js' }
	} as unknown as Event;

	for (const listener of page.listeners.get('error') ?? []) listener(event);
}

/** How long the shell lets a page arrive before it draws the page's skeleton in the old one's place. */
const LATE_MS = 180;

/** The skeleton in the canvas comes or goes, and the DOM change reaches the observer. */
function canvas(waiting: boolean): void {
	page.waiting = waiting;
	FakeObserver.current?.callback();
}

/** The app mounted on `path` after the boot script saw one of its scripts fail, with the page's skeleton up. */
function bootWithLostScript(path = '/settings/agent'): void {
	useShell.setState({ pathname: path, arriving: null });
	page.attributes.add(LOST_SCRIPT_ATTR);
	page.attributes.add(BOOT_FAILED_ATTR);
	page.notice = true;
	page.waiting = true;
}

let stop = () => {};

beforeEach(() => {
	jest.useFakeTimers();
	page.attributes.clear();
	page.listeners.clear();
	page.waiting = false;
	page.notice = false;
	FakeObserver.current = null;
	useShell.setState({ pathname: '/', arriving: null });

	const target = {
		addEventListener: (type: string, listener: (event: Event) => void) => listen(type, listener),
		removeEventListener: (type: string, listener: (event: Event) => void) => page.listeners.get(type)?.delete(listener)
	};

	Object.assign(globalThis, {
		MutationObserver: FakeObserver,
		document: {
			...target,
			body: {},
			documentElement: {
				hasAttribute: (name: string) => page.attributes.has(name),
				setAttribute: (name: string) => void page.attributes.add(name),
				removeAttribute: (name: string) => void page.attributes.delete(name)
			},
			querySelector: (selector: string) => {
				if (selector.includes('boot-notice')) return page.notice ? { remove: () => (page.notice = false) } : null;

				return page.waiting ? {} : null;
			}
		},
		window: { ...target, location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' } }
	});
});

afterEach(() => {
	stop();
	jest.useRealTimers();

	for (const name of ['MutationObserver', 'document', 'window']) {
		Reflect.deleteProperty(globalThis, name);
	}
});

describe('watchStuckRoute', () => {
	test('the first page is found stuck once its skeleton outstays the wait after a script lost at boot', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(500);
		canvas(true);
		jest.advanceTimersByTime(999);

		expect(changed).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1);

		expect(changed.mock.calls).toEqual([['/settings/agent']]);
	});

	test('a script lost after mount never finds a slow page stuck, even with the watch armed at boot', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(300);
		useShell.getState().follow('/review/a');
		jest.advanceTimersByTime(LATE_MS);
		useShell.getState().setRoute('/review/a');
		canvas(true);
		jest.advanceTimersByTime(1500);
		loseScript();
		jest.advanceTimersByTime(10_000);

		expect(changed).not.toHaveBeenCalled();
	});

	test('a page that renders before the wait is never found stuck, and the boot notice goes as it renders', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(500);
		canvas(false);

		expect(page.notice).toBe(false);
		expect(page.attributes.has(BOOT_FAILED_ATTR)).toBe(false);

		jest.advanceTimersByTime(10_000);

		expect(changed).not.toHaveBeenCalled();
	});

	test('a page held stuck shows when it renders after all', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(1500);
		canvas(false);

		expect(changed.mock.calls).toEqual([['/settings/agent'], [null]]);
	});

	test('the verdict holds until a page going elsewhere takes the canvas, and comes back at once on return', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(1500);
		useShell.getState().follow('/');

		expect(changed.mock.calls).toEqual([['/settings/agent']]);

		jest.advanceTimersByTime(LATE_MS);

		expect(changed.mock.calls).toEqual([['/settings/agent'], [null]]);

		useShell.getState().setRoute('/');
		canvas(false);
		useShell.getState().follow('/settings/agent');
		canvas(true);
		jest.advanceTimersByTime(LATE_MS);

		expect(changed.mock.calls).toEqual([['/settings/agent'], [null], ['/settings/agent']]);
	});

	test('a return that turns late before the shell draws its skeleton still finds the page stuck', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(1500);
		useShell.getState().follow('/');
		jest.advanceTimersByTime(LATE_MS);
		useShell.getState().setRoute('/');
		canvas(false);
		useShell.getState().follow('/settings/agent');
		jest.advanceTimersByTime(LATE_MS);
		canvas(true);

		expect(changed.mock.calls).toEqual([['/settings/agent'], [null], ['/settings/agent']]);
	});

	test('the watch stops reading the canvas once another page shows, and reads it again on the way back', () => {
		bootWithLostScript();
		stop = watchStuckRoute(() => {});
		jest.advanceTimersByTime(300);
		useShell.getState().follow('/');
		jest.advanceTimersByTime(LATE_MS);
		useShell.getState().setRoute('/');

		expect(FakeObserver.current).not.toBeNull();

		canvas(false);

		expect(FakeObserver.current).toBeNull();

		useShell.getState().follow('/settings/agent');

		expect(FakeObserver.current).not.toBeNull();
	});

	test('a page going elsewhere before the wait is not judged, and the page it reaches takes the notice down', () => {
		const changed = jest.fn();

		bootWithLostScript();
		stop = watchStuckRoute(changed);
		jest.advanceTimersByTime(300);
		useShell.getState().follow('/');
		jest.advanceTimersByTime(1200);

		expect(changed).not.toHaveBeenCalled();

		useShell.getState().setRoute('/');
		canvas(false);

		expect(page.notice).toBe(false);
		expect(changed).not.toHaveBeenCalled();
	});
});
