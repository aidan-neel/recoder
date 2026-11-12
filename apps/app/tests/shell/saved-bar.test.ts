import { afterEach, describe, expect, test } from 'bun:test';

import {
	barSteps,
	BOOT_QUEUE_SCRIPT,
	BOOT_SEARCH_SCRIPT,
	saveQueueCount,
	saveSearchSteps,
	TABS_KEY
} from '../../src/lib/shell/saved-bar';
import { inSample } from '../../src/lib/shell/routes';
import { fitPieces, fitTabs, type BarMeasure } from '../../src/lib/shell/tab-fit';
import { memoryStorage } from '../fixtures';
import { bootPieces, describeStrip, FakeNode } from './boot-dom';

/**
 * Five tabs of uneven, fractional widths, a Queue tab with a count, its
 * separator, a More trigger, the widest a tab gets and the three search
 * sizes with their gap.
 */
const PIECES: Omit<BarMeasure, 'room'> = {
	queue: 89.8,
	separator: 14.6,
	tabs: [
		{ id: 'a', width: 183.7 },
		{ id: 'b', width: 96.2 },
		{ id: 'c', width: 258 },
		{ id: 'd', width: 141.9 },
		{ id: 'e', width: 120.5 }
	],
	more: 70.3,
	widest: 258,
	search: { wide: 246, narrow: 176, icon: 36 }
};

/** The fit {@link PIECES} gives in `room` on the page of `active`, keeping room for `opening` before its tab opens. */
function fitIn(room: number, active: string | null, opening: string | null = null) {
	return fitTabs({ ...fitPieces(PIECES, opening), room, active });
}

/** The saved tabs behind {@link PIECES}: c runs, d has nothing open, e has no title of its own. */
const TABS = [
	{ id: 'a', repo: 'acme/api', pr: 1, title: 'Fix the cache', open: 3, high: true },
	{ id: 'b', repo: 'acme/web', pr: 2, title: 'Bump', open: 1, high: false },
	{ id: 'c', repo: 'acme/api', pr: 3, title: 'Move to Postgres', open: null, high: false },
	{ id: 'd', repo: 'acme/cli', pr: 4, title: 'Docs', open: 0, high: false },
	{ id: 'e', repo: 'acme/api', pr: 5, title: '#5', open: 2, high: false }
];

/** How {@link describeStrip} reads each of {@link TABS} drawn in the boot bar. */
const DRAWN: Record<string, string> = {
	a: 'api #1 Fix the cache ·3!',
	b: 'web #2 Bump ·1',
	c: 'api #3 Move to Postgres',
	d: 'cli #4 Docs',
	e: 'api #5 ·2'
};

/** The step that holds at `room`. */
function stepAt<T extends [number, ...unknown[]]>(steps: T[], room: number): T {
	let step = steps[0];

	for (const next of steps) if (room >= next[0]) step = next;

	return step;
}

describe('barSteps', () => {
	test('gives the search size and the More menu the fit picks at every whole room, with and without an active tab', () => {
		for (const [active, opening] of [
			[null, null],
			['a', null],
			['c', null],
			['e', null],
			['f', 'f']
		] as const) {
			const pieces = fitPieces(PIECES, opening);
			const steps = barSteps(pieces, active);

			for (let room = 0; room <= 1400; room++) {
				const fit = fitIn(room, active, opening);
				const [, search, more] = stepAt(steps, room);

				expect([active, room, search, more.map((index) => pieces.tabs[index].id)]).toEqual([
					active,
					room,
					fit.search,
					fit.hidden
				]);
			}
		}
	});
});

describe('BOOT_SEARCH_SCRIPT', () => {
	const globals = [
		'localStorage',
		'getComputedStyle',
		'document',
		'location',
		'innerWidth',
		'MutationObserver',
		'addEventListener'
	] as const;

	afterEach(() => {
		for (const name of globals) Reflect.deleteProperty(globalThis, name);
	});

	interface Boot {
		/** The search size it set, or null for the full one. */
		search: string | null;
		/** Where it draws the tabs. */
		box: FakeNode;
		/** Puts the boot bar in the document, as the parser does after the head script ran. */
		parse: () => void;
	}

	/** Runs the boot script's part in a window `width` wide on `path`, before the boot bar is in the document. */
	function boot(storage: Storage, width: number, path = '/'): Boot {
		const attributes = new Map<string, string>();
		const body = new FakeNode('body');
		const box = new FakeNode('span', { 'data-boot-tabs': '' });
		const observers: (() => void)[] = [];

		Object.assign(globalThis, {
			localStorage: storage,
			getComputedStyle: () => ({ fontSize: '16px' }),
			document: {
				documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
				querySelector: (selector: string) => body.querySelector(selector),
				createDocumentFragment: () => new FakeNode('#fragment')
			},
			MutationObserver: class {
				constructor(callback: () => void) {
					observers.push(callback);
				}

				observe() {}

				disconnect() {
					observers.splice(0);
				}
			},
			addEventListener: () => {},
			location: { pathname: path },
			innerWidth: width
		});

		new Function(BOOT_SEARCH_SCRIPT)();

		return {
			search: attributes.get('data-boot-search') ?? null,
			box,
			parse: () => {
				body.appendChild(bootPieces());
				body.appendChild(box);

				for (const observer of [...observers]) observer();
			}
		};
	}

	/** Storage holding the five tabs and the fit the bar saved for them, with 52px of chrome around the room. */
	function saved(): Storage {
		const storage = memoryStorage();

		Object.assign(globalThis, { localStorage: storage });
		storage.setItem(TABS_KEY, JSON.stringify(TABS));
		saveSearchSteps(PIECES, 52, 1);

		return storage;
	}

	test('sizes the boot search as the bar settled it for the window width and the page', () => {
		const storage = saved();

		for (const width of [360, 390, 600, 900, 1280, 1440]) {
			for (const [path, active] of [
				['/', null],
				['/review/c', 'c']
			] as const) {
				const size = fitIn(width - 52, active).search;

				expect([width, path, boot(storage, width, path).search]).toEqual([width, path, size === 'wide' ? null : size]);
			}
		}
	});

	test('draws the tabs the bar showed, its More menu and the pill on the page tab once the boot bar is parsed', () => {
		for (const [width, active] of [
			[1440, 'b'],
			[600, 'c']
		] as const) {
			const drawn = boot(saved(), width, `/review/${active}`);
			const fit = fitIn(width - 52, active);
			const more = fit.hidden.length > 0 ? [`More ${fit.hidden.length}`] : [];

			drawn.parse();

			expect(describeStrip(drawn.box)).toEqual([
				'|',
				...fit.visible.map((id) => `${id === active ? '*' : ''}${DRAWN[id]}`),
				...more
			]);
		}
	});

	test('marks the More menu as holding the page tab when the bar is too narrow for it', () => {
		const phone = boot(saved(), 360, '/review/c');

		phone.parse();

		expect(describeStrip(phone.box)).toEqual(['|', `More ${TABS.length}*`]);
	});

	test('keeps the room of a review page tab that is not saved yet, in the bar or in a More menu that holds it', () => {
		for (const width of [360, 390, 600, 900, 1280, 1440, 1920]) {
			const drawn = boot(saved(), width, '/review/f');
			const fit = fitIn(width - 52, 'f', 'f');
			const more = fit.hidden.length > 0 ? [`More ${fit.hidden.length}${fit.hidden.includes('f') ? '*' : ''}`] : [];

			drawn.parse();

			expect([width, drawn.search, describeStrip(drawn.box)]).toEqual([
				width,
				fit.search === 'wide' ? null : fit.search,
				['|', ...fit.visible.map((id) => (id === 'f' ? '[ ]' : DRAWN[id])), ...more]
			]);
		}
	});

	test('keeps a review page tab room with no tabs saved, drawing a More menu that holds it only when the bar is narrow', () => {
		const storage = memoryStorage();

		Object.assign(globalThis, { localStorage: storage });
		saveSearchSteps({ ...PIECES, tabs: [] }, 52, 1);

		const drawn = [390, 1440].map((width) => {
			const page = boot(storage, width, '/review/f');

			page.parse();

			return [page.search, describeStrip(page.box)];
		});

		expect(drawn).toEqual([
			['icon', ['|', 'More 1*']],
			[null, []]
		]);
	});

	test('draws nothing when the saved tabs changed since the bar measured them', () => {
		const storage = saved();

		storage.setItem(TABS_KEY, JSON.stringify([{ id: 'a', pr: 1 }]));

		const changed = boot(storage, 390);

		changed.parse();

		expect([changed.search, changed.box.children.length]).toEqual([null, 0]);
	});
});

describe('BOOT_QUEUE_SCRIPT', () => {
	const DAY_MS = 24 * 60 * 60 * 1000;

	afterEach(() => {
		for (const name of ['localStorage', 'document', 'location']) Reflect.deleteProperty(globalThis, name);
	});

	/** Runs the boot script's part on `path`; returns the digits it kept room for, or null when it kept none. */
	function boot(path: string): string | null {
		const attributes = new Set<string>();
		const style = new Map<string, string>();

		Object.assign(globalThis, {
			document: {
				documentElement: {
					setAttribute: (name: string) => attributes.add(name),
					style: { setProperty: (name: string, value: string) => style.set(name, value) }
				}
			},
			location: { pathname: path }
		});

		new Function(BOOT_QUEUE_SCRIPT)();

		return attributes.has('data-boot-queue') ? (style.get('--boot-queue-digits') ?? '') : null;
	}

	const PATHS = ['/', '/sample', '/review/sample', '/review/abc', '/settings/agent'];

	/** Storage holding a saved live list, which the count comes back with off the queue page. */
	function withList(): Storage {
		const storage = memoryStorage();

		storage.setItem('recoder.app.queue.v1', '{}');

		return storage;
	}

	test('keeps room for the count of the queue the page leads to, while its list is recent enough to come back', () => {
		Object.assign(globalThis, { localStorage: withList() });
		saveQueueCount('live', 12, Date.now() - DAY_MS + 60_000);
		saveQueueCount('sample', 3, null);

		for (const path of PATHS) expect([path, boot(path)]).toEqual([path, inSample(path) ? '1' : '2']);
	});

	test('keeps room for an old count only on the queue page, which loads it again', () => {
		Object.assign(globalThis, { localStorage: withList() });
		saveQueueCount('live', 12, Date.now() - DAY_MS - 60_000);

		expect(PATHS.filter((path) => !inSample(path)).map(boot)).toEqual(['2', null, null]);
	});

	test('keeps room for a recent live count off the queue page only while its saved list is there', () => {
		Object.assign(globalThis, { localStorage: memoryStorage() });
		saveQueueCount('live', 12, Date.now());
		saveQueueCount('sample', 3, null);

		expect(PATHS.map(boot)).toEqual(['2', '1', '1', null, null]);
	});

	test('keeps no room for a queue that last had nothing waiting', () => {
		Object.assign(globalThis, { localStorage: memoryStorage() });
		saveQueueCount('live', 0, Date.now());
		saveQueueCount('sample', 0, null);

		expect(PATHS.map(boot)).toEqual([null, null, null, null, null]);
	});

	test('keeps room on a queue page with nothing saved, for the count its first load brings, and none elsewhere', () => {
		Object.assign(globalThis, { localStorage: memoryStorage() });

		expect(PATHS.map((path) => boot(path) !== null)).toEqual([true, true, false, false, false]);
	});
});
