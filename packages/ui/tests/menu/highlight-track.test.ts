import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { trackHighlight } from '../../src/components/menu/highlight-track';

/** The browser globals the tracker uses, swapped for fakes in each test and put back after. */
const NAMES = [
	'HTMLElement',
	'MutationObserver',
	'ResizeObserver',
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'window',
	'document'
] as const;

const saved = new Map<string, unknown>();

/** Frames waiting to run, by id; `flush` runs them as the browser would before a paint. */
let frames = new Map<number, () => void>();
let nextFrame = 1;

/** The tracker's mutation callback, so a test can report list changes as a commit would. */
let notify: () => void = () => {};

/** The attributes the tracker asked to hear about. */
let watched: string[] = [];

/** Reports a row's attribute changing, as the browser would: only when the tracker watches it. */
function flip(attribute: string): void {
	if (watched.includes(attribute)) notify();
}

/** How many times the tracker read the selected row's box. */
let reads = 0;

/** The page's input listeners. The tracker adds them once, so every test shares this one page. */
const listeners = new Map<string, (event: Partial<PointerEvent>) => void>();

const page = {
	addEventListener: (type: string, listener: (event: Partial<PointerEvent>) => void) => listeners.set(type, listener)
};

/** Sends the page an input event, as the browser would before the list changes. */
function input(type: 'keydown' | 'pointermove', moved = 0): void {
	listeners.get(type)?.({ type, movementX: moved, movementY: 0 });
}

class FakeElement {
	style: Record<string, string> = {};
	dataset: Record<string, string> = {};
	offsetParent: FakeElement | null = null;
	offsetLeft = 0;
	offsetWidth = 200;
	clientWidth = 200;
	selected: FakeElement | null = null;
	/** True while the highlight skips its slide (`data-snap`). */
	snap = false;
	private top = 0;

	constructor(top = 0) {
		this.top = top;
	}

	get offsetTop(): number {
		reads += 1;

		return this.top;
	}

	get offsetHeight(): number {
		return 28;
	}

	moveTo(top: number): void {
		this.top = top;
	}

	toggleAttribute(_name: string, force: boolean): boolean {
		this.snap = force;

		return force;
	}

	contains(node: FakeElement): boolean {
		return node !== this;
	}

	querySelector(): FakeElement | null {
		return this.selected;
	}
}

function flush(): void {
	const due = [...frames.values()];

	frames = new Map();
	due.forEach((run) => run());
}

beforeEach(() => {
	for (const name of NAMES) saved.set(name, (globalThis as unknown as Record<string, unknown>)[name]);

	frames = new Map();
	reads = 0;

	Object.assign(globalThis, {
		HTMLElement: FakeElement,
		window: globalThis,
		document: page,
		requestAnimationFrame: (run: () => void) => {
			frames.set(nextFrame, run);

			return nextFrame++;
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
		MutationObserver: class {
			constructor(callback: () => void) {
				notify = callback;
			}

			observe(_target: unknown, options: { attributeFilter?: string[] }): void {
				watched = options.attributeFilter ?? [];
			}

			disconnect(): void {}
		},
		ResizeObserver: class {
			observe(): void {}

			disconnect(): void {}
		}
	});
});

afterEach(() => {
	for (const name of NAMES) Object.assign(globalThis, { [name]: saved.get(name) });
});

/** A list whose selected row starts at the top, with the tracker running on it. */
function setup() {
	const highlight = new FakeElement();
	const container = new FakeElement();
	const row = new FakeElement(0);

	row.offsetParent = container;
	container.selected = row;

	const stop = trackHighlight(highlight as unknown as HTMLElement, container as unknown as HTMLElement, '[x]');

	return { highlight, container, row, stop };
}

describe('trackHighlight', () => {
	test('moves once in the next frame for every list change before it, onto where the row ends up', () => {
		const { highlight, row } = setup();

		reads = 0;
		row.moveTo(28);
		notify();
		row.moveTo(56);
		notify();
		notify();

		expect(reads).toBe(0);

		flush();

		expect(reads).toBe(1);
		expect(highlight.style.transform).toBe('translate3d(0, 56px, 0)');
	});

	test('a change after the frame ran moves the highlight again', () => {
		const { highlight, row } = setup();

		row.moveTo(28);
		notify();
		flush();
		row.moveTo(84);
		notify();
		flush();

		expect(highlight.style.transform).toBe('translate3d(0, 84px, 0)');
	});

	test('cleanup drops a move still waiting for its frame', () => {
		const { highlight, row, stop } = setup();

		row.moveTo(28);
		notify();
		stop();
		flush();

		expect(highlight.style.transform).toBe('translate3d(0, 0px, 0)');
	});

	test('a move a key made snaps to its row, and the next one the pointer made slides', () => {
		const { highlight, row } = setup();

		input('keydown');
		row.moveTo(28);
		notify();
		flush();

		expect(highlight.snap).toBe(true);

		input('pointermove', 4);
		row.moveTo(56);
		notify();
		flush();

		expect(highlight.snap).toBe(false);
	});

	test('a pointer move with no distance, as a scroll makes up, leaves key moves snapping', () => {
		const { highlight, row } = setup();

		input('keydown');
		input('pointermove');
		row.moveTo(28);
		notify();
		flush();

		expect(highlight.snap).toBe(true);
	});

	test('a row marked current moves the highlight onto it', () => {
		const { highlight, container } = setup();
		const next = new FakeElement(84);

		next.offsetParent = container;
		container.selected = next;
		flip('data-current');
		flush();

		expect(highlight.style.transform).toBe('translate3d(0, 84px, 0)');
	});
});
