import { afterEach, beforeEach, expect, test } from 'bun:test';

import { BOOT_WAIT_ATTR, endBootWait } from '../../src/lib/shell/skeleton-bars';

/** `<html>`'s attributes; the hold's wait reads the full load's longer one from here. */
const attributes = new Set<string>();

/** A skeleton hold as the browser runs it: 240ms of wait under the full load's attribute, 120ms without, then its fade. */
class FakeHold {
	animationName = 'ui-skeleton-hold';
	effect = { getComputedTiming: () => ({ delay: attributes.has(BOOT_WAIT_ATTR) ? 240 : 120 }) };

	constructor(
		public startTime: number,
		public currentTime: number
	) {}
}

beforeEach(() => {
	attributes.clear();
	attributes.add(BOOT_WAIT_ATTR);
});

afterEach(() => {
	for (const name of ['CSSAnimation', 'KeyframeEffect', 'document', 'window']) Reflect.deleteProperty(globalThis, name);
});

/** Puts `holds` on the page and ends the full load's wait. */
function endWaitWith(holds: FakeHold[]): void {
	Object.assign(globalThis, {
		CSSAnimation: FakeHold,
		KeyframeEffect: class {},
		window: {},
		document: {
			documentElement: {
				hasAttribute: (name: string) => attributes.has(name),
				removeAttribute: (name: string) => attributes.delete(name)
			},
			getAnimations: () => holds
		}
	});

	endBootWait();
}

test('ending the full load’s wait keeps a fading bar where it was instead of jumping to full', () => {
	const fading = new FakeHold(100, 290);

	endWaitWith([fading]);

	expect(attributes.has(BOOT_WAIT_ATTR)).toBe(false);
	expect(fading.startTime).toBe(220);
});

test('ending the full load’s wait starts the fade of a bar the shorter wait has passed, rather than showing it part way', () => {
	const waiting = new FakeHold(100, 200);

	endWaitWith([waiting]);

	expect(waiting.startTime).toBe(180);
});

test('ending the full load’s wait leaves a bar the shorter wait has not passed on its own clock', () => {
	const fresh = new FakeHold(100, 60);

	endWaitWith([fresh]);

	expect(fresh.startTime).toBe(100);
});
