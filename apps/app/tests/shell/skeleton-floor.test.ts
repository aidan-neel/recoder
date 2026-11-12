import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';

import { barsSeen } from '../../src/lib/shell/skeleton-bars';
import { floorOnNavigation, watchFloor } from '../../src/lib/shell/skeleton-floor';

/** The canvas the floor watches; every node hanging from it is in the page. */
let canvas: FakeElement;

/** A bar's hold as the floor puts it back: where it starts, and whether it was ended early. */
class FakeHold {
	readonly animationName = 'ui-skeleton-hold';
	startTime: number | null = null;
	finished = false;

	constructor(readonly effect: { target: FakeElement }) {}

	finish(): void {
		this.finished = true;
	}
}

/**
 * Just enough of an element for the floor: a tree, attributes, inline custom
 * properties, own text, whether it is one of the kit's skeleton bars, and
 * its holds.
 */
class FakeElement {
	parentNode: FakeElement | null = null;
	children: FakeElement[] = [];
	holds: FakeHold[] = [];
	attributes = new Map<string, string>();
	properties = new Map<string, string>();
	style = {
		setProperty: (name: string, value: string) => this.properties.set(name, value),
		removeProperty: (name: string) => this.properties.delete(name)
	};

	constructor(
		readonly text = '',
		readonly bar = false
	) {}

	get isConnected(): boolean {
		return this === canvas || !!this.parentNode?.isConnected;
	}

	append(...nodes: FakeElement[]): this {
		for (const node of nodes) this.insertBefore(node, null);

		return this;
	}

	insertBefore(node: FakeElement, before: FakeElement | null): void {
		node.remove();
		node.parentNode = this;
		this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
	}

	remove(): void {
		this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1);
		this.parentNode = null;
	}

	descendants(): FakeElement[] {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}

	/** A page skeleton matches its own selector; anything else asked for is one of the kit's bars. */
	matches(selector: string): boolean {
		return selector === PAGE_SKELETON ? this.getAttribute('data-ui') === 'page-skeleton' : this.bar;
	}

	/** The first descendant a selector the floor uses would find: a page root, a page skeleton or a bar. */
	querySelector(selector: string): FakeElement | null {
		if (selector === ':scope > [data-ui]')
			return this.children.find((child) => child.attributes.has('data-ui')) ?? null;

		return this.descendants().find((node) => node.matches(selector)) ?? null;
	}

	/** The nearest element, itself included, that waits: the only ancestor the floor asks for. */
	closest(): FakeElement | null {
		if (this.attributes.get('data-skeleton-floor') === 'waiting') return this;

		return this.parentNode?.closest() ?? null;
	}

	querySelectorAll(): FakeElement[] {
		return this.descendants().filter((node) => node.bar);
	}

	getAnimations(): FakeHold[] {
		return [this, ...this.descendants()].flatMap((node) => node.holds);
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}
}

/** The floor's change handler, caught from its observer. */
let onChange: (records: unknown[]) => void = () => {};

/** Changes still queued in the floor's observer, which a navigation takes before they reach {@link onChange}. */
let queued: unknown[] = [];

/** The shell's stand-in for a page on its way. */
const PAGE_SKELETON = '[data-ui="page-skeleton"]';

/** The page's clock, which the tests move by hand. */
let clock = 0;

/** `performance.now`, pointed at {@link clock} for each test. */
let now: ReturnType<typeof spyOn>;

/** A skeleton root holding one bar that came into view at `since`, and whose hold started at `start`. */
function skeletonSeenAt(since: number, start: number | null = null): FakeElement {
	const bar = new FakeElement('', true);

	bar.holds.push(new FakeHold({ target: bar }));
	barsSeen().set(bar as unknown as Element, { since, start });

	return new FakeElement().append(bar);
}

/** React's swap of `before` for `after` in `parent`, and the records the floor's observer gets for it. */
function swap(parent: FakeElement, before: FakeElement, after: FakeElement): unknown[] {
	before.remove();
	parent.append(after);

	return [
		{ target: parent, removedNodes: [before], addedNodes: [] },
		{ target: parent, removedNodes: [], addedNodes: [after] }
	];
}

/** Puts a skeleton that came into view at `since` in a card on the canvas, then swaps it for content showing `text`. */
function replaceSkeletonSeenAt(since: number, text: string): Record<'card' | 'skeleton' | 'content', FakeElement> {
	const card = new FakeElement();
	const skeleton = skeletonSeenAt(since);
	const content = new FakeElement(text);

	canvas.append(card.append(skeleton));
	onChange(swap(card, skeleton, content));

	return { card, skeleton, content };
}

/** Moves the clock and the timers on together. */
function advance(ms: number): void {
	clock += ms;
	jest.advanceTimersByTime(ms);
}

beforeEach(() => {
	jest.useFakeTimers();
	clock = 1000;
	queued = [];
	canvas = new FakeElement();
	now = spyOn(performance, 'now').mockImplementation(() => clock);

	Object.assign(globalThis, {
		window: {},
		Element: FakeElement,
		HTMLElement: FakeElement,
		CSSAnimation: FakeHold,
		NodeFilter: { SHOW_TEXT: 4 },
		requestAnimationFrame: (run: () => void) => setTimeout(run, 16),
		getComputedStyle: () => ({
			position: 'static',
			paddingTop: '56px',
			paddingRight: '40px',
			paddingBottom: '40px',
			paddingLeft: '40px'
		}),
		MutationObserver: class {
			constructor(callback: (records: unknown[]) => void) {
				onChange = callback;
			}

			observe(): void {}

			takeRecords(): unknown[] {
				return queued.splice(0);
			}
		},
		document: {
			documentElement: { hasAttribute: () => false, removeAttribute: () => {} },
			getElementById: (id: string) => (id === 'app-canvas' ? canvas : null),
			createTreeWalker: (root: FakeElement) => {
				const texts = [root, ...root.descendants()].map((node) => ({
					nodeValue: node.text,
					parentElement: { tagName: 'DIV' }
				}));

				let next = 0;

				return { nextNode: () => texts[next++] ?? null };
			}
		}
	});

	watchFloor();
});

afterEach(() => {
	floorOnNavigation();
	jest.advanceTimersByTime(1000);
	jest.useRealTimers();
	now.mockRestore();

	for (const name of [
		'window',
		'Element',
		'HTMLElement',
		'CSSAnimation',
		'NodeFilter',
		'requestAnimationFrame',
		'getComputedStyle',
		'MutationObserver',
		'document'
	]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

describe('the skeleton floor', () => {
	test('content that replaces a skeleton seen for 100ms waits unseen until it has shown 250ms', () => {
		const card = new FakeElement();
		const skeleton = skeletonSeenAt(900);
		const content = new FakeElement().append(new FakeElement('Review complete. 3 confirmed findings.'));

		canvas.append(card.append(skeleton));
		onChange(swap(card, skeleton, content));

		expect(skeleton.parentNode).toBe(card);
		expect(card.children).toEqual([skeleton, content]);
		expect(content.getAttribute('data-skeleton-floor')).toBe('waiting');
		expect(card.properties.get('--skeleton-floor-inset')).toBe('56px 40px 40px 40px');

		advance(149);
		expect(skeleton.isConnected).toBe(true);

		advance(1);
		expect(skeleton.isConnected).toBe(false);
		expect(content.getAttribute('data-skeleton-floor')).toBe('shown');

		advance(32);
		expect(content.getAttribute('data-skeleton-floor')).toBeNull();
	});

	test('content that replaces a skeleton the compositor faded in, before the page drew it, waits until 250ms past the next frame', () => {
		const card = new FakeElement();
		const skeleton = skeletonSeenAt(900);
		const content = new FakeElement('Review complete.');

		for (const shown of barsSeen().values()) shown.drawn = Infinity;

		canvas.append(card.append(skeleton));
		onChange(swap(card, skeleton, content));

		expect(content.getAttribute('data-skeleton-floor')).toBe('waiting');

		advance(16);
		advance(249);
		expect(skeleton.isConnected).toBe(true);

		advance(1);
		expect(skeleton.isConnected).toBe(false);
	});

	test('a skeleton inside content that waits holds nothing back when its own content replaces it', () => {
		const card = new FakeElement();
		const skeleton = skeletonSeenAt(900);
		const late = skeletonSeenAt(1000);
		const content = new FakeElement('Review complete.').append(late);
		const checks = new FakeElement('2 checks passed');

		canvas.append(card.append(skeleton));
		onChange(swap(card, skeleton, content));
		advance(50);
		onChange(swap(content, late, checks));

		expect(late.isConnected).toBe(false);
		expect(checks.getAttribute('data-skeleton-floor')).toBeNull();

		advance(99);
		expect(content.getAttribute('data-skeleton-floor')).toBe('waiting');

		advance(1);
		expect(content.getAttribute('data-skeleton-floor')).toBe('shown');
	});

	test('a skeleton inside content that waits comes into view only as that content shows', () => {
		const card = new FakeElement();
		const skeleton = skeletonSeenAt(900);
		const late = skeletonSeenAt(1000);
		const content = new FakeElement('Review complete.').append(late);

		canvas.append(card.append(skeleton));
		onChange(swap(card, skeleton, content));
		advance(150);

		expect(barsSeen().get(late.children[0] as unknown as Element)?.since).toBe(1150);
	});

	test('a skeleton put back resumes each hold where it was, or ends it when its start is unknown', () => {
		const [first, second] = [new FakeElement(), new FakeElement()];
		const resumed = skeletonSeenAt(900, 700);
		const unknown = skeletonSeenAt(900);

		canvas.append(first.append(resumed), second.append(unknown));
		onChange([...swap(first, resumed, new FakeElement('Agent')), ...swap(second, unknown, new FakeElement('Models'))]);

		expect(resumed.getAnimations()[0]?.startTime).toBe(700);
		expect(resumed.getAnimations()[0]?.finished).toBe(false);
		expect(unknown.getAnimations()[0]?.finished).toBe(true);
	});

	test.each([
		['seen long enough', 700],
		['still too faint to read', 1010]
	])('content that replaces a skeleton %s shows at once', (_, since) => {
		const { skeleton, content } = replaceSkeletonSeenAt(since, '21 pull requests need a decision');

		expect(skeleton.isConnected).toBe(false);
		expect(content.getAttribute('data-skeleton-floor')).toBeNull();
	});

	test('a skeleton that takes a just-seen skeleton’s place does not wait: it keeps the clock instead', () => {
		const card = new FakeElement();
		const skeleton = skeletonSeenAt(950);
		const next = new FakeElement().append(new FakeElement('', true));

		canvas.append(card.append(skeleton));
		onChange(swap(card, skeleton, next));

		expect(skeleton.isConnected).toBe(false);
		expect(next.getAttribute('data-skeleton-floor')).toBeNull();
	});

	test('a navigation lets the waiting content show at once and takes the skeleton away', () => {
		const { card, skeleton, content } = replaceSkeletonSeenAt(950, 'Agent');

		floorOnNavigation();

		expect(skeleton.isConnected).toBe(false);
		expect(card.attributes.has('data-skeleton-floor-host')).toBe(false);
		expect(content.getAttribute('data-skeleton-floor')).toBe('shown');
	});

	test('the page moving on while content waits ends the wait', () => {
		const { card, skeleton, content } = replaceSkeletonSeenAt(950, 'Agent');
		const next = new FakeElement('Connections');

		onChange(swap(card, content, next));

		expect(skeleton.isConnected).toBe(false);
		expect(next.getAttribute('data-skeleton-floor')).toBeNull();
	});

	test('a skeleton the page adds while content waits shows on its own clock, not with the content', () => {
		const { card } = replaceSkeletonSeenAt(950, 'Agent');
		const late = new FakeElement().append(new FakeElement('', true));
		const more = new FakeElement('Models');

		card.append(late, more);
		onChange([{ target: card, removedNodes: [], addedNodes: [late, more] }]);

		expect(late.getAttribute('data-skeleton-floor')).toBeNull();
		expect(more.getAttribute('data-skeleton-floor')).toBe('waiting');
	});

	test('a bar in view that the page moves carries on from where its hold was', () => {
		const row = skeletonSeenAt(950, 700);

		canvas.append(row);
		onChange([{ target: canvas, removedNodes: [row], addedNodes: [row] }]);

		expect(row.getAnimations()[0]?.startTime).toBe(700);
	});
});

describe('the skeleton floor on a navigation', () => {
	/** The shell's skeleton for a page on its way: a page skeleton around that page's root, holding one bar seen at `since`. */
	function shellSkeleton(page: string, since: number): FakeElement {
		const stand = new FakeElement();
		const root = new FakeElement();

		stand.setAttribute('data-ui', 'page-skeleton');
		root.setAttribute('data-ui', page);

		return new FakeElement().append(stand.append(root.append(skeletonSeenAt(since))));
	}

	/** A page's root, named by its `data-ui`, showing `text`. */
	function pageRoot(name: string, text: string): FakeElement {
		const root = new FakeElement(text);

		root.setAttribute('data-ui', name);

		return root;
	}

	test('the shell’s skeleton for the page that lands keeps its floor, with the page waiting unseen', () => {
		const frame = new FakeElement();
		const pending = shellSkeleton('review-page', 900);
		const review = pageRoot('review-page', 'Review complete. 3 confirmed findings.');

		canvas.append(frame.append(pending));
		queued = swap(frame, pending, review);
		floorOnNavigation();

		expect(frame.children).toEqual([pending, review]);
		expect(review.getAttribute('data-skeleton-floor')).toBe('waiting');

		advance(150);

		expect(pending.isConnected).toBe(false);
		expect(review.getAttribute('data-skeleton-floor')).toBe('shown');
	});

	test('the page’s own skeleton, swapped in for the shell’s and out for content in one go, keeps the floor', () => {
		const frame = new FakeElement();
		const pending = shellSkeleton('review-page', 900);
		const bar = new FakeElement('', true);
		const own = pageRoot('review-page', '').append(bar);
		const review = pageRoot('review-page', 'Review complete. 3 confirmed findings.');

		bar.holds.push(new FakeHold({ target: bar }));
		canvas.append(frame.append(pending));
		queued = swap(frame, pending, own);
		floorOnNavigation();
		onChange(swap(frame, own, review));

		expect(frame.children).toEqual([own, review]);
		expect(bar.holds[0]?.finished).toBe(true);
		expect(review.getAttribute('data-skeleton-floor')).toBe('waiting');

		advance(150);

		expect(own.isConnected).toBe(false);
		expect(review.getAttribute('data-skeleton-floor')).toBe('shown');
	});

	test('a page never waits on a skeleton the shell drew for another page', () => {
		const frame = new FakeElement();
		const pending = shellSkeleton('review-page', 900);
		const settings = pageRoot('settings-page', 'Agent CLIs');

		canvas.append(frame.append(pending));
		queued = swap(frame, pending, settings);
		floorOnNavigation();

		expect(pending.isConnected).toBe(false);
		expect(settings.getAttribute('data-skeleton-floor')).toBeNull();
	});

	test('a page never waits on the old page’s own skeleton', () => {
		const frame = new FakeElement();
		const old = skeletonSeenAt(900);
		const review = pageRoot('review-page', 'Review complete.');

		canvas.append(frame.append(old));
		queued = swap(frame, old, review);
		floorOnNavigation();

		expect(old.isConnected).toBe(false);
		expect(review.getAttribute('data-skeleton-floor')).toBeNull();
	});
});
