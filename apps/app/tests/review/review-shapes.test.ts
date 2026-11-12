import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PullRequest, Review, ReviewListItem } from '@recoder/shared';

import { API_BASE } from '../../src/lib/api/http';
import type { QueueEntry } from '../../src/lib/queue/queue';
import { clearSnapshot, saveSnapshot } from '../../src/lib/queue/queue-snapshot';
import { guessRows, keepShape, keepShapeOf, SHAPE_SCRIPT, shapeFor } from '../../src/lib/review/review-shapes';
import { useReview } from '../../src/lib/review/review-store';
import { SAMPLE_DIFFS } from '../../src/lib/sample/sample-diff';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { memoryStorage } from '../fixtures';

const KEY = 'recoder.app.review-shapes.v1';

/** A queue row for `review`, whose pull request changes `changedFiles` files. */
function row(review: ReviewListItem, changedFiles: number): QueueEntry {
	const pull = { number: 1, title: 'A change', headSha: review.headSha, changedFiles, createdAt: '' } as PullRequest;

	return {
		key: review.id,
		repoId: 'repo',
		repo: 'acme/api',
		pull,
		review,
		state: 'needs-you',
		open: 0,
		tone: null,
		sent: 0,
		receipts: 0
	};
}

/** Saves a queue holding `entries`, as the queue page does after a refresh. */
function saveQueue(entries: QueueEntry[]): void {
	saveSnapshot({ at: Date.now(), repos: [], entries, missing: [], progress: {} });
}

/** Runs the before-paint script at `path` as the server's HTML would, and returns the CSS variables it set on `<html>`. */
function runScript(path: string): Record<string, string> {
	const vars: Record<string, string> = {};
	const style = { setProperty: (name: string, value: string) => void (vars[name] = value) };

	new Function('localStorage', 'document', 'location', SHAPE_SCRIPT)(
		localStorage,
		{ documentElement: { style } },
		{ pathname: path }
	);

	return vars;
}

beforeEach(() => {
	Object.assign(globalThis, { localStorage: memoryStorage() });
});

describe('review skeleton shapes', () => {
	test('malformed entries are skipped and counts are cut to the most each part draws', () => {
		localStorage.setItem(
			KEY,
			JSON.stringify([['a', 2, 4, 1], ['b', 1.5, 4, 1], ['c', 3], [7, 1, 1, 1], ['d', 40, 5000, 12], 'e'])
		);

		expect(shapeFor('a')).toEqual([2, 4, 1]);
		expect(shapeFor('d')).toEqual([40, 999, 12]);
		expect(shapeFor('b')).toBeNull();
	});

	test('a review with no shape kept has none, never another review’s', () => {
		expect(shapeFor('x')).toBeNull();

		localStorage.setItem(KEY, 'not json');

		expect(shapeFor(null)).toBeNull();

		keepShape('a', [1, 2, 3]);
		keepShape('b', [0, 0, 0]);

		expect(shapeFor('missing')).toBeNull();
		expect(shapeFor(null)).toBeNull();
		expect(shapeFor('a')).toEqual([1, 2, 3]);
		expect(shapeFor('b')).toEqual([0, 0, 0]);
	});

	test('only the latest 30 reviews are kept, and keeping one again moves it to the end', () => {
		for (let index = 0; index < 32; index++) keepShape(`r${index}`, [1, 1, 1]);

		keepShape('r5', [2, 2, 2]);

		const ids = (JSON.parse(localStorage.getItem(KEY) ?? '[]') as [string][]).map((entry) => entry[0]);

		expect(ids).toHaveLength(30);
		expect(ids[0]).toBe('r2');
		expect(ids.at(-1)).toBe('r5');
		expect(ids.filter((id) => id === 'r5')).toHaveLength(1);
	});

	test('the before-paint script picks the shape the page would, from the same entries', () => {
		localStorage.setItem(KEY, JSON.stringify([['a', 2, 4, 1], ['b', 1.5, 4, 1], ['c', 5000, 7, 0], 'x']));

		expect(runScript('/review/a')).toEqual({
			'--review-skeleton-decisions': '2',
			'--review-skeleton-files': '4',
			'--review-skeleton-summary': '1',
			'--review-skeleton-rail-min': '0px'
		});

		expect(runScript('/review/c')).toEqual({
			'--review-skeleton-decisions': '999',
			'--review-skeleton-files': '7',
			'--review-skeleton-summary': '0',
			'--review-skeleton-rail-min': '0px'
		});

		expect(runScript('/review/b')).toEqual({});
		expect(runScript('/review/missing')).toEqual({});
		expect(runScript('/')).toEqual({});

		localStorage.setItem(KEY, '{"a":[1,1,1]}');

		expect(runScript('/review/a')).toEqual({});
	});

	test('a review with no shape kept takes its rows from the saved queue’s row for it, when it is done', () => {
		const done = { ...SAMPLE_REVIEW, id: 'done' };
		const draft = { ...SAMPLE_REVIEW, id: 'draft', status: 'draft' as const };
		const running = { ...SAMPLE_REVIEW, id: 'running', status: 'running' as const };

		saveQueue([row(done, 7), row(draft, 3), row(running, 5)]);

		expect(guessRows('done')).toEqual([4, 7]);
		expect(guessRows('draft')).toEqual([0, 0]);
		expect(guessRows('running')).toBeNull();
		expect(guessRows('missing')).toBeNull();
	});

	test('a saved queue row that does not read as a review gives no guess', () => {
		const review = { ...SAMPLE_REVIEW, id: 'odd', findings: null } as unknown as Review;
		const entry = row({ ...SAMPLE_REVIEW, id: 'count' }, 2);

		clearSnapshot();

		localStorage.setItem(
			'recoder.app.queue.v1',
			JSON.stringify({
				at: Date.now(),
				api: API_BASE,
				repos: [],
				missing: [],
				progress: {},
				entries: [row(review, 2), { ...entry, pull: { ...entry.pull, changedFiles: -1 } }]
			})
		);

		expect(guessRows('odd')).toBeNull();
		expect(guessRows('count')).toBeNull();
	});

	describe('keeping a shown review’s shape', () => {
		const frames: (() => void)[] = [];

		beforeEach(() => {
			const summary = { offsetHeight: 90 };
			const slot = { querySelector: () => summary };

			Object.assign(globalThis, {
				location: { pathname: '/review/shown' },
				document: { querySelector: () => slot },
				getComputedStyle: () => ({ lineHeight: '30px' }),
				requestAnimationFrame: (run: () => void) => frames.push(run),
				cancelAnimationFrame: () => {}
			});

			useReview.setState({
				id: 'shown',
				status: 'ready',
				review: { ...SAMPLE_REVIEW, id: 'shown' },
				files: SAMPLE_DIFFS
			});
		});

		afterEach(() => {
			frames.length = 0;

			for (const name of [
				'location',
				'document',
				'getComputedStyle',
				'requestAnimationFrame',
				'cancelAnimationFrame'
			]) {
				Reflect.deleteProperty(globalThis, name);
			}
		});

		test('a review left before the page goes idle still keeps the shape its first frame read', () => {
			const leave = keepShapeOf('shown');

			frames.splice(0).forEach((run) => run());
			leave();

			expect(shapeFor('shown')).toEqual([4, 9, 3]);
		});
	});

	/** Last, since a list storage would not take stays in the module for the rest of the run. */
	test('a shape kept while storage is full or blocked still draws for the rest of the session', () => {
		const refuse = () => {
			throw new Error('refused');
		};

		Object.assign(globalThis, { localStorage: { ...memoryStorage(), setItem: refuse } });
		keepShape('a', [1, 2, 3]);

		expect(shapeFor('a')).toEqual([1, 2, 3]);

		Object.assign(globalThis, { localStorage: { ...memoryStorage(), getItem: refuse, setItem: refuse } });
		keepShape('b', [4, 5, 6]);

		expect(shapeFor('a')).toEqual([1, 2, 3]);
		expect(shapeFor('b')).toEqual([4, 5, 6]);
	});
});
