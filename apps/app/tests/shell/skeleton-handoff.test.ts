import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';

import { barsSeen } from '../../src/lib/shell/skeleton-bars';
import { handOffOnLeave, showSkeletonsAfterNavigation, WATCH_BARS_SCRIPT } from '../../src/lib/shell/skeleton-handoff';

/** The element a text node sits in: its tag, and `closest`, which matches a selector that names its tag. */
interface FakeElement {
	tagName: string;
	closest: (selector: string) => FakeElement | null;
}

/** A text node as the tree walker hands it out, with the element it sits in. */
interface FakeText {
	nodeValue: string;
	parentElement: FakeElement;
}

/** A skeleton bar in the canvas: its inline style, and whether it is still in the page. */
const bar = {
	style: { animation: '' },
	isConnected: true,
	matches: () => true,
	closest: () => null,
	querySelectorAll: () => []
};

/** When the frame after a navigation runs, on the page's clock. */
const FRAME_AT = 500;

/** The canvas's text nodes, in document order. */
let texts: FakeText[] = [];

/** Text in `tagName`, as the tree walker hands it out. */
function textIn(tagName: string, nodeValue: string): FakeText {
	const parentElement: FakeElement = {
		tagName,
		closest: (selector) =>
			selector.split(',').some((part) => part.trim().toUpperCase() === tagName) ? parentElement : null
	};

	return { nodeValue, parentElement };
}

/** The canvas as the hand-off reads it: one skeleton bar, no route skeleton, and `texts`. */
const canvas = {
	querySelector: (selector: string) => (selector === '[data-ui="skeleton"]' ? bar : null),
	querySelectorAll: () => [bar]
};

/** `<html>`'s attributes, which carry the full load's longer skeleton wait and the app's mount. */
const root = {
	attributes: new Set<string>(),
	setAttribute: (name: string) => root.attributes.add(name),
	removeAttribute: (name: string) => root.attributes.delete(name),
	hasAttribute: (name: string) => root.attributes.has(name)
};

/** A CSS animation as the boot script reads it: its name, its start (null while the browser has not dated it) and its effect. */
interface FakeAnimation {
	animationName: string;
	startTime: number | null;
	effect?: { target: object; getComputedTiming: () => { delay: number } };
}

/** The page's animations, as `document.getAnimations()` returns them. */
let animations: FakeAnimation[] = [];

/** The paint observer the boot script registers, once it has. */
let reportPaint: ((startTime: number) => void) | null = null;

/** The callback of the observer the boot script puts on `<html>` to hear the app mount. */
let reportMounted: ((records: unknown[], observer: { disconnect: () => void }) => void) | null = null;

/** The page-wide listeners the boot script adds, by event type. */
let listeners = new Map<string, (event: object) => void>();

/** Whether the canvas holds a skeleton, as the boot script's query finds it. */
let canvasSkeleton = false;

/** The time the next frame hands its callbacks, on the animations' clock. */
let frameAt = 0;

/** How many times the page's animations were read. */
let reads = 0;

/** Runs the boot script's skeleton part, as the page's head would, keeping the observer it puts on `<html>`. */
function runBootScript(): void {
	const Observer = (globalThis as unknown as { MutationObserver: unknown }).MutationObserver;

	(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
		constructor(callback: (records: unknown[], observer: { disconnect: () => void }) => void) {
			reportMounted = callback;
		}

		observe(): void {}
	};

	new Function(WATCH_BARS_SCRIPT)();
	(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = Observer;
}

/** The app marking `<html>` as mounted, as its shell does once it has taken over. */
function mount(): void {
	root.attributes.add('data-mounted');
	reportMounted?.([], { disconnect: () => {} });
}

/** A bar in the canvas, as the boot script's listener sees an event's target. */
function canvasBar(): { isConnected: boolean; closest: () => object } {
	return { isConnected: true, closest: () => canvas };
}

/** A bar's hold that started at `startTime` and waits `delay` before its fade. */
function holdOf(target: object, startTime: number, delay: number): FakeAnimation {
	return { animationName: 'ui-skeleton-hold', startTime, effect: { target, getComputedTiming: () => ({ delay }) } };
}

/** Runs the frame that comes next, handing its callbacks `at`. */
function frame(at: number): void {
	frameAt = at;
	jest.advanceTimersByTime(16);
}

/** A skeleton hold that started at `startTime`. */
function hold(startTime: number | null): FakeAnimation {
	return { animationName: 'ui-skeleton-hold', startTime };
}

/** Waits out the microtasks a navigation's hand-off queues before it touches the canvas. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn++) await Promise.resolve();
}

beforeEach(() => {
	jest.useFakeTimers();
	bar.style.animation = '';
	bar.isConnected = true;
	texts = [];
	animations = [];
	reportPaint = null;
	reportMounted = null;
	listeners = new Map();
	canvasSkeleton = false;
	frameAt = 0;
	reads = 0;
	root.attributes.clear();

	Object.assign(globalThis, {
		NodeFilter: { SHOW_TEXT: 4 },
		MutationObserver: class {
			observe(): void {}
			disconnect(): void {}
			takeRecords(): [] {
				return [];
			}
		},
		window: {},
		requestAnimationFrame: (run: (at: number) => void) => setTimeout(() => run(frameAt), 16),
		addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener),
		PerformanceObserver: class {
			constructor(callback: (list: { getEntries: () => { startTime: number }[] }, observer: unknown) => void) {
				reportPaint = (startTime) => callback({ getEntries: () => [{ startTime }] }, { disconnect: () => {} });
			}

			observe(): void {}
		},
		document: {
			body: {},
			documentElement: root,
			querySelector: () => (canvasSkeleton ? bar : null),
			getAnimations: () => {
				reads++;

				return animations;
			},
			getElementById: (id: string) => (id === 'app-canvas' ? canvas : null),
			createTreeWalker: (node: { texts?: FakeText[] }) => {
				const list = node === canvas ? texts : (node.texts ?? []);
				let next = 0;

				return { nextNode: () => list[next++] ?? null };
			}
		}
	});
});

afterEach(() => {
	jest.advanceTimersByTime(10_000);
	jest.useRealTimers();
	Reflect.deleteProperty(globalThis, 'NodeFilter');
	Reflect.deleteProperty(globalThis, 'MutationObserver');
	Reflect.deleteProperty(globalThis, 'window');
	Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
	Reflect.deleteProperty(globalThis, 'addEventListener');
	Reflect.deleteProperty(globalThis, 'PerformanceObserver');
	Reflect.deleteProperty(globalThis, 'document');
});

describe('showSkeletonsAfterNavigation', () => {
	test('a skeleton inside a scroll area shows in full at once, though the scroll area adds a style with text', async () => {
		texts = [textIn('STYLE', '[data-radix-scroll-area-viewport]{scrollbar-width:none}')];

		showSkeletonsAfterNavigation();
		await settle();

		expect(bar.style.animation).toBe('none');
	});

	test('a skeleton shown at once counts as in view from the frame that draws it, with its light starting then', async () => {
		showSkeletonsAfterNavigation();
		await settle();

		expect(barsSeen().has(bar as unknown as Element)).toBe(false);

		const now = spyOn(performance, 'now').mockReturnValue(FRAME_AT);

		jest.advanceTimersByTime(16);
		now.mockRestore();

		expect(barsSeen().get(bar as unknown as Element)?.since).toBe(FRAME_AT);
		expect(window.__recoderBarLights?.get(bar as unknown as Element)).toBe(FRAME_AT);
	});

	test('a skeleton gone before any frame drew it never counts as in view', async () => {
		showSkeletonsAfterNavigation();
		await settle();
		bar.isConnected = false;
		jest.advanceTimersByTime(16);

		expect(barsSeen().has(bar as unknown as Element)).toBe(false);
	});

	test('a page that lands with its text leaves a late skeleton on its own hold', async () => {
		texts = [textIn('H1', '21 pull requests need a decision'), textIn('P', 'acme/api, opened 2 hours ago')];
		showSkeletonsAfterNavigation();
		await settle();

		expect(bar.style.animation).toBe('');
	});

	test('a page whose only words are its nav and title shows its skeleton in full at once', async () => {
		texts = [textIn('NAV', 'Agent'), textIn('H1', 'Agent')];
		showSkeletonsAfterNavigation();
		await settle();

		expect(bar.style.animation).toBe('none');
	});

	test("a navigation ends the full load's longer skeleton wait", () => {
		runBootScript();
		expect(root.hasAttribute('data-boot-wait')).toBe(true);

		showSkeletonsAfterNavigation();

		expect(root.hasAttribute('data-boot-wait')).toBe(false);
	});
});

describe('handOffOnLeave', () => {
	/** Hands a route skeleton holding `routeTexts`, whose bars already show, off to a page showing `texts`. */
	async function leaveShownSkeleton(routeTexts: FakeText[]): Promise<void> {
		const shownBar = {};

		const route = {
			isConnected: true,
			texts: routeTexts,
			matches: () => false,
			querySelector: () => shownBar,
			querySelectorAll: () => []
		};

		Object.assign((globalThis as unknown as { window: Window }).window, {
			__recoderHoldStart: 0,
			__recoderShownBars: new WeakSet([shownBar])
		});

		const cleanup = handOffOnLeave(route as unknown as HTMLElement);

		cleanup();
		route.isConnected = false;
		await settle();
	}

	test('the page’s own skeleton beside the nav its page skeleton showed keeps the clock and shows at once', async () => {
		const nav = [textIn('A', 'Agent'), textIn('H1', 'Agent')];

		texts = nav;
		await leaveShownSkeleton(nav);

		expect(bar.style.animation).toBe('none');
	});

	test('a late skeleton that lands with the page’s content holds on its own', async () => {
		texts = [textIn('P', 'Review complete. 17 confirmed findings.')];
		await leaveShownSkeleton([]);

		expect(bar.style.animation).toBe('');
	});
});

describe('WATCH_BARS_SCRIPT', () => {
	test('holds the compositor dated after the first paint, or not yet, move back to the paint', () => {
		animations = [hold(140), hold(null), { animationName: 'ui-shimmer', startTime: 150 }];
		runBootScript();
		reportPaint?.(100);

		expect(animations.map((animation) => animation.startTime)).toEqual([100, 100, 150]);
		expect((globalThis as unknown as { window: Window }).window.__recoderHoldStart).toBe(100);
	});

	test('a hold already running before the paint dates the rest, and none moves later', () => {
		animations = [hold(130), hold(90), hold(null)];
		runBootScript();
		reportPaint?.(100);

		expect(animations.map((animation) => animation.startTime)).toEqual([90, 90, 90]);
	});

	test("an app that mounts with no skeleton in its canvas (a 404) ends the full load's longer wait", () => {
		runBootScript();
		mount();

		expect(root.hasAttribute('data-boot-wait')).toBe(false);
	});

	test("an app that mounts with its page's skeleton still showing keeps the longer wait for the hand-off", () => {
		canvasSkeleton = true;
		runBootScript();
		mount();

		expect(root.hasAttribute('data-boot-wait')).toBe(true);
	});

	test('every bar that starts in one frame is read with a single look at the page’s animations', () => {
		const bars = Array.from({ length: 50 }, canvasBar);

		animations = bars.flatMap((target) => [
			holdOf(target, 100, 240),
			{ animationName: 'ui-shimmer', startTime: 100, effect: holdOf(target, 100, 0).effect }
		]);

		runBootScript();

		for (const target of bars) {
			listeners.get('animationstart')?.({ animationName: 'ui-shimmer', target });
			listeners.get('animationstart')?.({ animationName: 'ui-skeleton-hold', target });
		}

		frame(345);

		expect(reads).toBe(1);
		expect(window.__recoderBarLights?.get(bars[0] as unknown as Element)).toBe(100);
		expect(barsSeen().get(bars[49] as unknown as Element)?.start).toBe(100);
	});

	test('a bar already on screen counts as in view once its fade passes faint, and as drawn from the next frame the page draws', () => {
		const target = canvasBar();

		animations = [
			holdOf(target, 100, 240),
			{ animationName: 'ui-shimmer', startTime: 110, effect: holdOf(target, 100, 0).effect }
		];

		runBootScript();
		listeners.get('animationstart')?.({ animationName: 'ui-shimmer', target });
		listeners.get('animationstart')?.({ animationName: 'ui-skeleton-hold', target });
		frame(345);

		expect(barsSeen().get(target as unknown as Element)).toMatchObject({ since: 365, drawn: Infinity });

		const now = spyOn(performance, 'now').mockReturnValue(518);

		frame(500);

		expect(barsSeen().get(target as unknown as Element)).toMatchObject({ since: 365, drawn: 518 });

		now.mockRestore();
	});

	test('a bar not on screen before its fade counts as in view from when the page draws the first frame with it past faint', () => {
		const target = canvasBar();
		const now = spyOn(performance, 'now').mockReturnValue(518);

		animations = [holdOf(target, 100, 240)];
		runBootScript();
		listeners.get('animationstart')?.({ animationName: 'ui-skeleton-hold', target });
		frame(345);

		expect(barsSeen().get(target as unknown as Element)?.since).toBe(Infinity);

		frame(500);

		expect(barsSeen().get(target as unknown as Element)?.since).toBe(518);

		now.mockRestore();
	});

	test('a bar taken away before any frame drew its fade past faint never counts as in view', () => {
		const target = canvasBar();

		animations = [holdOf(target, 100, 240)];
		runBootScript();
		listeners.get('animationstart')?.({ animationName: 'ui-skeleton-hold', target });
		frame(345);
		target.isConnected = false;
		frame(500);

		expect(barsSeen().get(target as unknown as Element)?.since).toBe(Infinity);
	});

	test('once the app has mounted, the holds are left to the hand-off', () => {
		animations = [hold(140)];
		runBootScript();
		root.attributes.add('data-mounted');
		reportPaint?.(100);

		expect(animations[0]?.startTime).toBe(140);
	});
});
