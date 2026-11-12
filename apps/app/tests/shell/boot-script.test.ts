import { describe, expect, test } from 'bun:test';

import { BOOT_SCRIPT } from '../../src/lib/shell/boot-script';

/** What the notice says when the app has not mounted in time. */
const STALLED = 'Recoder didn’t finish loading.';

interface FakeElement {
	tagName: string;
	textContent: string;
	children: FakeElement[];
	setAttribute: () => void;
	appendChild: (child: FakeElement) => void;
	addEventListener: () => void;
}

/** One of the app's scripts in the head; the nomodule polyfill is one a modern browser never loads. */
interface FakeScript {
	tagName: 'SCRIPT';
	src: string;
	noModule: boolean;
}

function element(tag: string): FakeElement {
	const node: FakeElement = {
		tagName: tag.toUpperCase(),
		textContent: '',
		children: [],
		setAttribute: () => {},
		appendChild: (child) => void node.children.push(child),
		addEventListener: () => {}
	};

	return node;
}

/**
 * Runs the boot script in a page made of plain objects, on a clock the test
 * moves: `advance` runs the script's timers as they fall due, `arrive`
 * finishes a script's request and fires its `load`, `timed` gives a script a
 * timing entry with no `load` the watch saw, and `notice` reads the notice.
 * `start` is when the head ran the script, from the start of the page load.
 */
function boot(scripts: FakeScript[], start = 0) {
	const attributes = new Set<string>();
	const listeners = new Map<string, ((event: { target: unknown }) => void)[]>();
	const timers: { at: number; run: () => void }[] = [];
	const entries = new Map<string, { responseEnd: number }>();
	const body = element('body');
	let clock = start;

	const env = {
		window: {},
		document: {
			documentElement: {
				setAttribute: (name: string) => void attributes.add(name),
				hasAttribute: (name: string) => attributes.has(name),
				removeAttribute: (name: string) => void attributes.delete(name),
				style: { setProperty: () => {} }
			},
			body,
			createElement: element,
			querySelectorAll: (selector: string) => (selector.includes('/_next/') ? scripts : []),
			querySelector: () => null,
			addEventListener: () => {},
			fonts: { load: () => Promise.resolve() },
			getAnimations: () => []
		},
		navigator: { userAgent: 'test' },
		location: { pathname: '/', reload: () => {} },
		localStorage: { getItem: () => null },
		getComputedStyle: () => ({ getPropertyValue: () => '', fontSize: '16px' }),
		addEventListener: (type: string, listener: (event: { target: unknown }) => void) => {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		performance: {
			now: () => clock,
			getEntriesByName: (name: string) => (entries.has(name) ? [entries.get(name)] : [])
		},
		setTimeout: (run: () => void, ms: number) => void timers.push({ at: clock + ms, run }),
		MutationObserver: class {
			observe(): void {}
		},
		PerformanceObserver: class {
			observe(): void {}
		},
		requestAnimationFrame: () => 0,
		innerWidth: 1440
	};

	new Function(...Object.keys(env), BOOT_SCRIPT)(...Object.values(env));

	return {
		advance(ms: number): void {
			const end = clock + ms;

			for (let next = timers.sort((a, b) => a.at - b.at)[0]; next && next.at <= end; next = timers[0]) {
				timers.shift();
				clock = next.at;
				next.run();
				timers.sort((a, b) => a.at - b.at);
			}

			clock = end;
		},
		arrive(script: FakeScript): void {
			entries.set(script.src, { responseEnd: clock });

			for (const listener of listeners.get('load') ?? []) listener({ target: script });
		},
		timed(script: FakeScript, at: number): void {
			entries.set(script.src, { responseEnd: at });
		},
		mount(): void {
			attributes.add('data-mounted');
		},
		notice(): string | null {
			return body.children[0]?.children[0]?.textContent ?? null;
		}
	};
}

function script(name: string, noModule = false): FakeScript {
	return { tagName: 'SCRIPT', src: `http://localhost/_next/static/chunks/${name}.js`, noModule };
}

/**
 * The scripts come in, the app mounts a moment later and the page stays a
 * long while; returns the notice it shows by then.
 */
function mountAfter(page: ReturnType<typeof boot>, scripts: FakeScript[]): string | null {
	scripts.forEach(page.arrive);
	page.advance(100);
	page.mount();
	page.advance(20_000);

	return page.notice();
}

describe('the boot watchdog', () => {
	test('a slow boot whose scripts are still coming in keeps its skeleton and never shows the notice', () => {
		const scripts = [script('main'), script('page')];
		const page = boot(scripts);

		page.advance(9000);

		expect(page.notice()).toBeNull();
		expect(mountAfter(page, scripts)).toBeNull();
	});

	test('scripts that never come in still get the notice once the longer wait runs out', () => {
		const scripts = [script('main'), script('page')];
		const page = boot(scripts);

		page.advance(300);
		page.arrive(scripts[0]);
		page.advance(14_600);

		expect(page.notice()).toBeNull();

		page.advance(200);

		expect(page.notice()).toBe(STALLED);
	});

	test('an app that has not mounted a moment after its last script landed gets the notice', () => {
		const scripts = [script('main'), script('page')];
		const page = boot(scripts);

		page.advance(9000);
		scripts.forEach(page.arrive);
		page.advance(1999);

		expect(page.notice()).toBeNull();

		page.advance(300);

		expect(page.notice()).toBe(STALLED);
	});

	test('a page whose document came in late still gives its scripts the whole wait', () => {
		const scripts = [script('main')];
		const page = boot(scripts, 10_000);

		page.advance(14_000);

		expect(page.notice()).toBeNull();
		expect(mountAfter(page, scripts)).toBeNull();
	});

	test('a boot whose scripts all came in shows the notice at the wait, the nomodule polyfill aside', () => {
		const scripts = [script('main'), script('polyfill', true)];
		const page = boot(scripts);

		page.timed(scripts[0], 200);
		page.advance(7999);

		expect(page.notice()).toBeNull();

		page.advance(1);

		expect(page.notice()).toBe(STALLED);
	});
});
