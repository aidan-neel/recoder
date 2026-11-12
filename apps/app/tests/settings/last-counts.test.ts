import { afterEach, describe, expect, test } from 'bun:test';

import {
	countScript,
	heightScript,
	keptHeightAt,
	parseCounts,
	parseHeights,
	type GroupKey
} from '../../src/lib/settings/last-counts';
import { memoryStorage } from '../fixtures';

type LastCounts = typeof import('../../src/lib/settings/last-counts');

const HEIGHTS_KEY = 'recoder.app.settings-heights.v1';

let reloads = 0;

/** Runs a before-paint script against `stored` at a window width, and returns the CSS variables it set on `<html>`. */
function runScript(script: string, stored: string | null, innerWidth = 1440): Record<string, string> {
	const vars: Record<string, string> = {};
	const style = { setProperty: (name: string, value: string) => (vars[name] = value) };

	new Function('localStorage', 'document', 'innerWidth', script)(
		{ getItem: () => stored },
		{ documentElement: { style } },
		innerWidth
	);

	return vars;
}

/** A new copy of the module, as a page load gets it: nothing in memory, only what `storage` kept, at a window width. */
async function load(storage: Storage, innerWidth = 1440): Promise<LastCounts> {
	Object.assign(globalThis, { localStorage: storage, window: { innerWidth } });
	reloads += 1;

	return (await import(`../../src/lib/settings/last-counts.ts?reload=${reloads}`)) as LastCounts;
}

/** The heights `storage` keeps, as stored. */
function keptIn(storage: Storage): unknown {
	return JSON.parse(storage.getItem(HEIGHTS_KEY) ?? 'null');
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'localStorage');
	Reflect.deleteProperty(globalThis, 'window');
});

describe('stored row counts', () => {
	test('keeps whole counts, caps them, and drops anything else', () => {
		expect(parseCounts('{"agents":3,"providers":40,"repos":-1,"storage":"1","x":1.5}')).toEqual({
			agents: 3,
			providers: 12
		});
	});

	test('storage that is empty or not JSON reads as never stored', () => {
		expect(parseCounts(null)).toEqual({});
		expect(parseCounts('not json')).toEqual({});
		expect(parseCounts('[3]')).toEqual({});
	});

	test('the before-paint script copies a stored count onto the page, capped like a parsed one', () => {
		expect(runScript(countScript('providers'), '{"providers":40}')).toEqual({ '--settings-rows-providers': '12' });
	});

	test('the before-paint script hides what needs rows and shows the empty state for an empty list', () => {
		expect(runScript(countScript('storage'), '{"storage":0}')).toEqual({
			'--settings-rows-storage': '0',
			'--settings-if-rows-storage': 'none',
			'--settings-if-empty-storage': 'block'
		});
	});

	test('the before-paint script leaves a bad count, or another list’s, to the first-visit length', () => {
		expect(runScript(countScript('repos'), '{"repos":1.5}')).toEqual({});
		expect(runScript(countScript('repos'), '{"repos":"3"}')).toEqual({});
		expect(runScript(countScript('repos'), '{"agents":3}')).toEqual({});
	});
});

describe('kept group heights', () => {
	test('keeps well-formed entries under known groups, the first four per group, and drops anything else', () => {
		const entries = [390, 391, 392, 393, 394].map((width) => ({ width, height: 200 }));

		expect(
			parseHeights(
				JSON.stringify({
					providers: [{ width: 1440, height: 444 }, { width: 390.5, height: 200 }, 'x', null],
					models: entries,
					repos: [{ width: 1440, height: 0 }],
					forges: [{ width: 1440, height: 5000 }],
					storage: { width: 1440, height: 96 },
					other: [{ width: 1440, height: 96 }]
				})
			)
		).toEqual({ providers: [{ width: 1440, height: 444 }], models: entries.slice(0, 4) });
	});

	test('storage that is not JSON, or not an object, reads as never measured', () => {
		expect(parseHeights('not json')).toEqual({});
		expect(parseHeights('[{"width":1440,"height":96}]')).toEqual({});
	});

	test('a height kept at this window width counts over one kept near it', () => {
		const kept = parseHeights('{"models":[{"width":391,"height":243},{"width":390,"height":200}]}');

		expect(keptHeightAt(kept, 'models', 390, false)).toBe(200);
	});

	test('without one, the height kept nearest in the same band counts, the latest of two as near', () => {
		const kept = parseHeights(
			'{"models":[{"width":400,"height":230},{"width":380,"height":250},{"width":330,"height":271}]}'
		);

		expect(keptHeightAt(kept, 'models', 391, false)).toBe(230);
		expect(keptHeightAt(kept, 'models', 390, false)).toBe(230);
	});

	test('a height kept in another band never counts', () => {
		const kept = parseHeights('{"models":[{"width":1440,"height":154},{"width":730,"height":199}]}');

		expect(keptHeightAt(kept, 'models', 900, false)).toBe(199);
		expect(keptHeightAt(kept, 'models', 1280, false)).toBe(154);
		expect(keptHeightAt(kept, 'models', 700, false)).toBeUndefined();
		expect(keptHeightAt(kept, 'models', 1920, false)).toBeUndefined();
	});

	test('a group whose rows are known counts only a height kept at this very width', () => {
		const kept = parseHeights('{"reviewers":[{"width":390,"height":198}]}');

		expect(keptHeightAt(kept, 'reviewers', 390, true)).toBe(198);
		expect(keptHeightAt(kept, 'reviewers', 391, true)).toBeUndefined();
	});

	test('the before-paint script picks the height the page picks once it can read storage', () => {
		const stored = JSON.stringify({
			providers: [{ width: 1440, height: 444.5 }],
			models: [
				{ width: 400, height: 230 },
				{ width: 'x', height: 1 },
				{ width: 380, height: 250 },
				{ width: 730, height: 199 },
				{ width: 1440, height: 154 },
				{ width: 500, height: 183 }
			],
			reviewers: [{ width: 390, height: 198 }],
			forges: [{ width: 1440, height: 5000 }]
		});

		const groups: [GroupKey, boolean][] = [
			['providers', false],
			['models', false],
			['reviewers', true],
			['forges', false]
		];

		for (const width of [320, 380, 390, 391, 460, 500, 730, 911, 912, 1440, 1920, 2400]) {
			const expected = Object.fromEntries(
				groups.flatMap(([group, exact]) => {
					const height = keptHeightAt(parseHeights(stored), group, width, exact);

					return height === undefined ? [] : [[`--settings-height-${group}`, `${height}px`]];
				})
			);

			expect(runScript(heightScript(groups), stored, width)).toEqual(expected);
		}
	});

	test('a height is kept per window width, the latest first, for at most four widths', async () => {
		const storage = memoryStorage();

		for (const width of [390, 414, 1440, 1280, 375]) (await load(storage, width)).rememberHeight('models', width / 2);

		expect(keptIn(storage)).toEqual({
			models: [375, 1280, 1440, 414].map((width) => ({ width, height: width / 2 }))
		});
	});

	test('a height kept again at a width replaces the one kept there, rounded to the hundredth', async () => {
		const storage = memoryStorage();
		const counts = await load(storage, 390);

		counts.rememberHeight('models', 243);
		counts.rememberHeight('models', 154.004);

		expect(keptIn(storage)).toEqual({ models: [{ width: 390, height: 154 }] });
	});

	test('a list whose length changes drops the heights of the groups it shapes', async () => {
		const storage = memoryStorage();
		const counts = await load(storage);

		counts.rememberCount('repos', 3);
		counts.rememberHeight('repos', 200);
		counts.rememberHeight('repoGuidelines', 270);
		counts.rememberCount('repos', 4);

		expect(keptIn(storage)).toEqual({});
	});

	test('a list whose length changes keeps the heights of the groups it doesn’t shape', async () => {
		const storage = memoryStorage();
		const counts = await load(storage);

		counts.rememberCount('providers', 2);
		counts.rememberHeight('agentClis', 212);
		counts.rememberHeight('models', 154);
		counts.rememberCount('providers', 7);

		expect(keptIn(storage)).toEqual({
			agentClis: [{ width: 1440, height: 212 }],
			models: [{ width: 1440, height: 154 }]
		});
	});

	test('a list stored again at the same length keeps the heights', async () => {
		const storage = memoryStorage();
		const counts = await load(storage);

		counts.rememberCount('repos', 3);
		counts.rememberHeight('repos', 200);
		counts.rememberCount('repos', 3);

		expect(keptIn(storage)).toEqual({ repos: [{ width: 1440, height: 200 }] });
	});
});
